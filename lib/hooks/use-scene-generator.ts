'use client';

import { useCallback, useRef } from 'react';
import { useStageStore } from '@/lib/store/stage';
import { getCurrentModelConfig } from '@/lib/utils/model-config';
import { useSettingsStore } from '@/lib/store/settings';
import type { ProviderId } from '@/lib/ai/providers';
import { db } from '@/lib/utils/database';
import type { SceneOutline, PdfImage, ImageMapping } from '@/lib/types/generation';
import type { AgentInfo } from '@/lib/generation/generation-pipeline';
import type { Scene } from '@/lib/types/stage';
import type { Action, SpeechAction } from '@/lib/types/action';
import type { TTSProviderId } from '@/lib/audio/types';
import { splitLongSpeechActions } from '@/lib/audio/tts-utils';
import { generateMediaForOutlines } from '@/lib/media/media-orchestrator';
import { createLogger } from '@/lib/logger';

const log = createLogger('SceneGenerator');

interface SceneContentResult {
  success: boolean;
  content?: unknown;
  effectiveOutline?: SceneOutline;
  error?: string;
}

interface SceneActionsResult {
  success: boolean;
  scene?: Scene;
  previousSpeeches?: string[];
  error?: string;
}

interface LlmModelOverride {
  providerId: ProviderId;
  modelId: string;
}

function getApiHeaders(modelOverride?: LlmModelOverride): HeadersInit {
  const config = getCurrentModelConfig();
  const settings = useSettingsStore.getState();
  const imageProviderConfig = settings.imageProvidersConfig?.[settings.imageProviderId];
  const videoProviderConfig = settings.videoProvidersConfig?.[settings.videoProviderId];

  // When a per-call override is supplied (e.g. from the regenerate-scene dialog),
  // resolve its provider config and build the LLM headers from it instead of
  // mutating the global settings store. Image/video/TTS headers keep using the
  // global settings.
  let modelString = config.modelString || '';
  let apiKey = config.apiKey || '';
  let baseUrl = config.baseUrl || '';
  let providerType = config.providerType || '';
  if (modelOverride) {
    const { providerId: pid, modelId: mid } = modelOverride;
    const pCfg = settings.providersConfig?.[pid];
    if (pCfg) {
      modelString = `${pid}:${mid}`;
      apiKey = pCfg.apiKey || '';
      baseUrl = pCfg.baseUrl || '';
      providerType = pCfg.type || providerType;
    }
  }

  return {
    'Content-Type': 'application/json',
    'x-model': modelString,
    'x-api-key': apiKey,
    'x-base-url': baseUrl,
    'x-provider-type': providerType,
    // Image generation provider
    'x-image-provider': settings.imageProviderId || '',
    'x-image-model': settings.imageModelId || '',
    'x-image-api-key': imageProviderConfig?.apiKey || '',
    'x-image-base-url': imageProviderConfig?.baseUrl || '',
    // Video generation provider
    'x-video-provider': settings.videoProviderId || '',
    'x-video-model': settings.videoModelId || '',
    'x-video-api-key': videoProviderConfig?.apiKey || '',
    'x-video-base-url': videoProviderConfig?.baseUrl || '',
    // Media generation toggles
    'x-image-generation-enabled': String(settings.imageGenerationEnabled ?? false),
    'x-video-generation-enabled': String(settings.videoGenerationEnabled ?? false),
  };
}

/** Call POST /api/generate/scene-content (step 1) */
async function fetchSceneContent(
  params: {
    outline: SceneOutline;
    allOutlines: SceneOutline[];
    stageId: string;
    pdfImages?: PdfImage[];
    imageMapping?: ImageMapping;
    stageInfo: {
      name: string;
      description?: string;
      language?: string;
      style?: string;
    };
    agents?: AgentInfo[];
  },
  signal?: AbortSignal,
  modelOverride?: LlmModelOverride,
): Promise<SceneContentResult> {
  const response = await fetch('/api/generate/scene-content', {
    method: 'POST',
    headers: getApiHeaders(modelOverride),
    body: JSON.stringify(params),
    signal,
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({ error: 'Request failed' }));
    if (response.status === 402) {
      return { success: false, error: 'INSUFFICIENT_CREDITS' };
    }
    return { success: false, error: data.error || `HTTP ${response.status}` };
  }

  return response.json();
}

/** Call POST /api/generate/scene-actions (step 2) */
async function fetchSceneActions(
  params: {
    outline: SceneOutline;
    allOutlines: SceneOutline[];
    content: unknown;
    stageId: string;
    agents?: AgentInfo[];
    previousSpeeches?: string[];
    userProfile?: string;
  },
  signal?: AbortSignal,
  modelOverride?: LlmModelOverride,
): Promise<SceneActionsResult> {
  const response = await fetch('/api/generate/scene-actions', {
    method: 'POST',
    headers: getApiHeaders(modelOverride),
    body: JSON.stringify(params),
    signal,
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({ error: 'Request failed' }));
    if (response.status === 402) {
      return { success: false, error: 'INSUFFICIENT_CREDITS' };
    }
    return { success: false, error: data.error || `HTTP ${response.status}` };
  }

  return response.json();
}

/** Generate TTS for one speech action and store in IndexedDB */
export async function generateAndStoreTTS(
  audioId: string,
  text: string,
  signal?: AbortSignal,
): Promise<void> {
  const settings = useSettingsStore.getState();
  if (settings.ttsProviderId === 'browser-native-tts') return;

  const ttsProviderConfig = settings.ttsProvidersConfig?.[settings.ttsProviderId];
  const response = await fetch('/api/generate/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      audioId,
      ttsProviderId: settings.ttsProviderId,
      ttsModelId: ttsProviderConfig?.modelId,
      ttsVoice: settings.ttsVoice,
      ttsSpeed: settings.ttsSpeed,
      ttsApiKey: ttsProviderConfig?.apiKey || undefined,
      ttsBaseUrl: ttsProviderConfig?.baseUrl || undefined,
    }),
    signal,
  });

  const data = await response
    .json()
    .catch(() => ({ success: false, error: response.statusText || 'Invalid TTS response' }));
  if (!response.ok || !data.success || !data.base64 || !data.format) {
    const err = new Error(
      data.details || data.error || `TTS request failed: HTTP ${response.status}`,
    );
    log.warn('TTS failed for', audioId, ':', err);
    throw err;
  }

  const binary = atob(data.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: `audio/${data.format}` });
  await db.audioFiles.put({
    id: audioId,
    blob,
    format: data.format,
    createdAt: Date.now(),
  });

  // Upload to cloud storage and write back the MinIO URL into the speech action
  const stageId = useStageStore.getState().stage?.id;
  if (stageId) {
    import('@/lib/sync/classroom-sync').then(({ uploadMediaToServer }) => {
      uploadMediaToServer(stageId, 'tts', blob, `${audioId}.${data.format}`, audioId)
        .then((result) => {
          if (result?.url) {
            useStageStore.getState().updateSpeechActionAudioUrl(audioId, result.url);
          }
        })
        .catch(() => {});
    });
  }
}

/** Generate TTS for all speech actions in a scene — concurrent batches (max 3). */
async function generateTTSForScene(
  scene: Scene,
  signal?: AbortSignal,
): Promise<{ success: boolean; failedCount: number; error?: string }> {
  const providerId = useSettingsStore.getState().ttsProviderId;
  scene.actions = splitLongSpeechActions(scene.actions || [], providerId);
  const speechActions = scene.actions.filter(
    (a): a is SpeechAction => a.type === 'speech' && !!a.text,
  );
  if (speechActions.length === 0) return { success: true, failedCount: 0 };

  // Assign audioIds first (before parallel execution)
  for (const action of speechActions) {
    action.audioId = `tts_${action.id}`;
  }

  const TTS_CONCURRENCY = 3;
  let failedCount = 0;
  let lastError: string | undefined;

  for (let i = 0; i < speechActions.length; i += TTS_CONCURRENCY) {
    const batch = speechActions.slice(i, i + TTS_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (action) => {
        await generateAndStoreTTS(action.audioId!, action.text, signal);
      }),
    );

    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      if (r.status === 'rejected') {
        failedCount++;
        lastError =
          r.reason instanceof Error
            ? r.reason.message
            : `TTS failed for action ${batch[j].id}`;
        log.warn('TTS generation failed:', {
          providerId,
          actionId: batch[j].id,
          textLength: batch[j].text.length,
          error: lastError,
        });
      }
    }
  }

  return {
    success: failedCount === 0,
    failedCount,
    error: lastError,
  };
}

export interface UseSceneGeneratorOptions {
  onSceneGenerated?: (scene: Scene, index: number) => void;
  onSceneFailed?: (outline: SceneOutline, error: string) => void;
  onPhaseChange?: (phase: 'content' | 'actions', outline: SceneOutline) => void;
  onComplete?: () => void;
}

export interface GenerationParams {
  pdfImages?: PdfImage[];
  imageMapping?: ImageMapping;
  stageInfo: {
    name: string;
    description?: string;
    language?: string;
    style?: string;
  };
  agents?: AgentInfo[];
  userProfile?: string;
}

export function useSceneGenerator(options: UseSceneGeneratorOptions = {}) {
  const abortRef = useRef(false);
  const generatingRef = useRef(false);
  const mediaAbortRef = useRef<AbortController | null>(null);
  const fetchAbortRef = useRef<AbortController | null>(null);
  const lastParamsRef = useRef<GenerationParams | null>(null);
  const generateRemainingRef = useRef<((params: GenerationParams) => Promise<void>) | null>(null);

  const store = useStageStore;

  const generateRemaining = useCallback(
    async (params: GenerationParams) => {
      lastParamsRef.current = params;
      if (generatingRef.current) return;
      generatingRef.current = true;
      abortRef.current = false;
      store.getState().setCreditsInsufficient(false);
      const removeGeneratingOutline = (outlineId: string) => {
        const current = store.getState().generatingOutlines;
        if (!current.some((o) => o.id === outlineId)) return;
        store.getState().setGeneratingOutlines(current.filter((o) => o.id !== outlineId));
      };

      // Create a new AbortController for this generation run
      fetchAbortRef.current = new AbortController();
      const signal = fetchAbortRef.current.signal;

      const state = store.getState();
      const { outlines, scenes, stage } = state;
      const startEpoch = state.generationEpoch;
      if (!stage || outlines.length === 0) {
        generatingRef.current = false;
        return;
      }

      store.getState().setGenerationStatus('generating');

      // Determine pending outlines
      const completedOrders = new Set(scenes.map((s) => s.order));
      const pending = outlines
        .filter((o) => !completedOrders.has(o.order))
        .sort((a, b) => a.order - b.order);

      if (pending.length === 0) {
        store.getState().setGenerationStatus('completed');
        store.getState().setGeneratingOutlines([]);
        options.onComplete?.();
        generatingRef.current = false;
        return;
      }

      store.getState().setGeneratingOutlines(pending);

      // Launch media generation in parallel — does not block content/action generation
      mediaAbortRef.current = new AbortController();
      generateMediaForOutlines(outlines, stage.id, mediaAbortRef.current.signal).catch((err) => {
        log.warn('Media generation error:', err);
      });

      // Get previousSpeeches from last completed scene
      let previousSpeeches: string[] = [];
      const sortedScenes = [...scenes].sort((a, b) => a.order - b.order);
      if (sortedScenes.length > 0) {
        const lastScene = sortedScenes[sortedScenes.length - 1];
        previousSpeeches = (lastScene.actions || [])
          .filter((a): a is SpeechAction => a.type === 'speech')
          .map((a) => a.text);
      }

      // Pipeline generation loop — prefetch next scene's content while current
      // scene's actions + TTS are generating. This overlaps the two heaviest
      // LLM calls and can reduce total time by ~30-40%.
      //
      // Timeline:
      //   Scene 1: [content] → [actions + TTS]
      //   Scene 2:              [content(prefetch)] → [actions + TTS]
      //   Scene 3:                                     [content(prefetch)] → ...
      try {
        let pausedByFailureOrAbort = false;

        // Prefetch content for the first pending outline immediately
        let nextContentPromise: Promise<SceneContentResult> | null = null;
        const prefetchContent = (outline: SceneOutline) =>
          fetchSceneContent(
            {
              outline,
              allOutlines: outlines,
              stageId: stage.id,
              pdfImages: params.pdfImages,
              imageMapping: params.imageMapping,
              stageInfo: params.stageInfo,
              agents: params.agents,
            },
            signal,
          );

        for (let idx = 0; idx < pending.length; idx++) {
          const outline = pending[idx];

          if (abortRef.current || store.getState().generationEpoch !== startEpoch) {
            store.getState().setGenerationStatus('paused');
            pausedByFailureOrAbort = true;
            break;
          }

          store.getState().setCurrentGeneratingOrder(outline.order);

          // Step 1: Get content — either from prefetch or fresh fetch
          options.onPhaseChange?.('content', outline);
          const contentResult =
            nextContentPromise !== null
              ? await nextContentPromise
              : await prefetchContent(outline);
          nextContentPromise = null;

          if (!contentResult.success || !contentResult.content) {
            if (abortRef.current || store.getState().generationEpoch !== startEpoch) {
              pausedByFailureOrAbort = true;
              break;
            }
            if (contentResult.error === 'INSUFFICIENT_CREDITS') {
              store.getState().setCreditsInsufficient(true);
              store.getState().setGenerationStatus('paused');
              pausedByFailureOrAbort = true;
              break;
            }
            store.getState().addFailedOutline(outline);
            options.onSceneFailed?.(outline, contentResult.error || 'Content generation failed');
            store.getState().setGenerationStatus('paused');
            pausedByFailureOrAbort = true;
            break;
          }

          if (abortRef.current || store.getState().generationEpoch !== startEpoch) {
            store.getState().setGenerationStatus('paused');
            pausedByFailureOrAbort = true;
            break;
          }

          // ── Prefetch next scene's content while we generate current actions + TTS ──
          if (idx + 1 < pending.length) {
            nextContentPromise = prefetchContent(pending[idx + 1]);
          }

          // Step 2: Generate actions + assemble scene
          options.onPhaseChange?.('actions', outline);
          const actionsResult = await fetchSceneActions(
            {
              outline: contentResult.effectiveOutline || outline,
              allOutlines: outlines,
              content: contentResult.content,
              stageId: stage.id,
              agents: params.agents,
              previousSpeeches,
              userProfile: params.userProfile,
            },
            signal,
          );

          if (actionsResult.success && actionsResult.scene) {
            const scene = actionsResult.scene;
            const settings = useSettingsStore.getState();

            // TTS generation — failure means the whole scene fails
            if (settings.ttsEnabled && settings.ttsProviderId !== 'browser-native-tts') {
              const ttsResult = await generateTTSForScene(scene, signal);
              if (!ttsResult.success) {
                if (abortRef.current || store.getState().generationEpoch !== startEpoch) {
                  pausedByFailureOrAbort = true;
                  break;
                }
                store.getState().addFailedOutline(outline);
                options.onSceneFailed?.(outline, ttsResult.error || 'TTS generation failed');
                store.getState().setGenerationStatus('paused');
                pausedByFailureOrAbort = true;
                break;
              }
            }

            // Epoch changed — stage switched, discard this scene
            if (store.getState().generationEpoch !== startEpoch) {
              pausedByFailureOrAbort = true;
              break;
            }

            removeGeneratingOutline(outline.id);
            store.getState().addScene(scene);
            options.onSceneGenerated?.(scene, outline.order);
            previousSpeeches = actionsResult.previousSpeeches || [];
          } else {
            if (abortRef.current || store.getState().generationEpoch !== startEpoch) {
              pausedByFailureOrAbort = true;
              break;
            }
            if (actionsResult.error === 'INSUFFICIENT_CREDITS') {
              store.getState().setCreditsInsufficient(true);
              store.getState().setGenerationStatus('paused');
              pausedByFailureOrAbort = true;
              break;
            }
            store.getState().addFailedOutline(outline);
            options.onSceneFailed?.(outline, actionsResult.error || 'Actions generation failed');
            store.getState().setGenerationStatus('paused');
            pausedByFailureOrAbort = true;
            break;
          }
        }

        if (!abortRef.current && !pausedByFailureOrAbort) {
          store.getState().setGenerationStatus('completed');
          store.getState().setGeneratingOutlines([]);
          options.onComplete?.();
        }
      } catch (err: unknown) {
        // AbortError is expected when stop() is called — don't treat as failure
        if (err instanceof DOMException && err.name === 'AbortError') {
          log.info('Generation aborted');
          store.getState().setGenerationStatus('paused');
        } else {
          throw err;
        }
      } finally {
        generatingRef.current = false;
        fetchAbortRef.current = null;
      }
    },
    [options, store],
  );

  // Keep ref in sync so retrySingleOutline can call it
  generateRemainingRef.current = generateRemaining;

  const stop = useCallback(() => {
    abortRef.current = true;
    store.getState().bumpGenerationEpoch();
    fetchAbortRef.current?.abort();
    mediaAbortRef.current?.abort();
  }, [store]);

  const isGenerating = useCallback(() => generatingRef.current, []);

  /** Retry a single failed outline from scratch (content → actions → TTS). */
  const retrySingleOutline = useCallback(
    async (outlineId: string) => {
      const state = store.getState();
      const outline = state.failedOutlines.find((o) => o.id === outlineId);
      const params = lastParamsRef.current;
      if (!outline || !state.stage || !params) return;

      const removeGeneratingOutline = () => {
        const current = store.getState().generatingOutlines;
        if (!current.some((o) => o.id === outlineId)) return;
        store.getState().setGeneratingOutlines(current.filter((o) => o.id !== outlineId));
      };

      // Remove from failed list and mark as generating
      store.getState().retryFailedOutline(outlineId);
      store.getState().setCreditsInsufficient(false);
      store.getState().setGenerationStatus('generating');
      const currentGenerating = store.getState().generatingOutlines;
      if (!currentGenerating.some((o) => o.id === outline.id)) {
        store.getState().setGeneratingOutlines([...currentGenerating, outline]);
      }

      const abortController = new AbortController();
      const signal = abortController.signal;

      try {
        // Step 1: Content
        const contentResult = await fetchSceneContent(
          {
            outline,
            allOutlines: state.outlines,
            stageId: state.stage.id,
            pdfImages: params.pdfImages,
            imageMapping: params.imageMapping,
            stageInfo: params.stageInfo,
            agents: params.agents,
          },
          signal,
        );

        if (!contentResult.success || !contentResult.content) {
          if (contentResult.error === 'INSUFFICIENT_CREDITS') {
            store.getState().setCreditsInsufficient(true);
            store.getState().setGenerationStatus('paused');
            return;
          }
          store.getState().addFailedOutline(outline);
          return;
        }

        // Step 2: Actions
        const sortedScenes = [...store.getState().scenes].sort((a, b) => a.order - b.order);
        const lastScene = sortedScenes[sortedScenes.length - 1];
        const previousSpeeches = lastScene
          ? (lastScene.actions || [])
              .filter((a): a is SpeechAction => a.type === 'speech')
              .map((a) => a.text)
          : [];

        const actionsResult = await fetchSceneActions(
          {
            outline: contentResult.effectiveOutline || outline,
            allOutlines: state.outlines,
            content: contentResult.content,
            stageId: state.stage.id,
            agents: params.agents,
            previousSpeeches,
            userProfile: params.userProfile,
          },
          signal,
        );

        if (!actionsResult.success || !actionsResult.scene) {
          if (actionsResult.error === 'INSUFFICIENT_CREDITS') {
            store.getState().setCreditsInsufficient(true);
            store.getState().setGenerationStatus('paused');
            return;
          }
          store.getState().addFailedOutline(outline);
          return;
        }

        // Step 3: TTS
        const settings = useSettingsStore.getState();
        if (settings.ttsEnabled && settings.ttsProviderId !== 'browser-native-tts') {
          const ttsResult = await generateTTSForScene(actionsResult.scene, signal);
          if (!ttsResult.success) {
            store.getState().addFailedOutline(outline);
            return;
          }
        }

        removeGeneratingOutline();
        store.getState().addScene(actionsResult.scene);

        // Resume remaining generation if there are pending outlines
        if (store.getState().generatingOutlines.length > 0 && lastParamsRef.current) {
          generateRemainingRef.current?.(lastParamsRef.current);
        }
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          store.getState().addFailedOutline(outline);
        }
      }
    },
    [store],
  );

  /**
   * Regenerate a single already-completed scene in-place. The scene is
   * removed, any media tasks for its elements are cleared, then content →
   * actions → TTS → media are re-run using an (optionally tweaked) outline.
   *
   * Owner-only. Callers are responsible for gating on `isOwner`.
   */
  const regenerateScene = useCallback(
    async (
      sceneId: string,
      overrides?: Partial<
        Pick<SceneOutline, 'title' | 'description' | 'keyPoints' | 'mediaGenerations'>
      >,
      modelOverride?: LlmModelOverride,
    ) => {
      const state = store.getState();
      const scene = state.scenes.find((s) => s.id === sceneId);
      if (!state.stage || !scene) return;
      // Guard against double-clicks
      if (state.regeneratingSceneIds.includes(sceneId)) {
        log.info(`[regenerateScene] ${sceneId} already regenerating, skipping`);
        return;
      }

      const params = lastParamsRef.current ?? {
        stageInfo: {
          name: state.stage.name || '',
          description: state.stage.description,
          language: state.stage.language,
          style: state.stage.style,
        },
      };

      const originalOutline = state.outlines.find((o) => o.order === scene.order);
      if (!originalOutline) return;

      const effectiveOutline: SceneOutline = {
        ...originalOutline,
        ...(overrides ?? {}),
      };

      // Persist the tweaked outline so refreshes / later regens see the edits.
      const didOverride = !!overrides && Object.keys(overrides).length > 0;
      if (didOverride) {
        const nextOutlines = state.outlines.map((o) =>
          o.order === scene.order ? effectiveOutline : o,
        );
        store.getState().setOutlines(nextOutlines);
      }

      // Clear media tasks tied to this scene's elements so the orchestrator
      // re-enqueues them instead of skipping as "already completed".
      const elementIdsToClear = new Set<string>();
      for (const m of effectiveOutline.mediaGenerations || []) {
        elementIdsToClear.add(m.elementId);
      }
      for (const m of originalOutline.mediaGenerations || []) {
        elementIdsToClear.add(m.elementId);
      }
      if (elementIdsToClear.size > 0) {
        const { useMediaGenerationStore } = await import('@/lib/store/media-generation');
        useMediaGenerationStore.setState((s) => {
          const tasks = { ...s.tasks };
          for (const id of elementIdsToClear) delete tasks[id];
          return { tasks };
        });
      }

      // Non-destructive flow: keep the old scene visible (so the current page
      // never blanks out), don't touch generatingOutlines (which belongs to
      // the initial full-doc pipeline — polluting it loses other in-flight
      // pages), and only swap content on success via `replaceScene`.
      store.getState().setSceneRegenerating(sceneId, true);
      store.getState().setCreditsInsufficient(false);

      const abortController = new AbortController();
      const signal = abortController.signal;

      try {
        // Previous-speech context: pull from the scene immediately preceding
        // this one by `order` among the *currently rendered* scenes. The old
        // scene is still present at this point, so this stays stable.
        const sortedScenes = [...store.getState().scenes].sort((a, b) => a.order - b.order);
        const priorScenes = sortedScenes.filter((s) => s.order < scene.order);
        const lastPrior = priorScenes[priorScenes.length - 1];
        const previousSpeeches = lastPrior
          ? (lastPrior.actions || [])
              .filter((a): a is SpeechAction => a.type === 'speech')
              .map((a) => a.text)
          : [];

        const contentResult = await fetchSceneContent(
          {
            outline: effectiveOutline,
            allOutlines: store.getState().outlines,
            stageId: state.stage.id,
            pdfImages: params.pdfImages,
            imageMapping: params.imageMapping,
            stageInfo: params.stageInfo,
            agents: params.agents,
          },
          signal,
          modelOverride,
        );

        if (!contentResult.success || !contentResult.content) {
          if (contentResult.error === 'INSUFFICIENT_CREDITS') {
            store.getState().setCreditsInsufficient(true);
          }
          // Failure path: do NOT call addFailedOutline (that bucket is for the
          // initial pipeline — polluting it would show a red "failed" card in
          // the sidebar for a page that actually still exists). Just surface
          // the error in logs and leave the original scene intact.
          log.warn(`[regenerateScene] content generation failed for ${sceneId}`);
          return;
        }

        const actionsResult = await fetchSceneActions(
          {
            outline: contentResult.effectiveOutline || effectiveOutline,
            allOutlines: store.getState().outlines,
            content: contentResult.content,
            stageId: state.stage.id,
            agents: params.agents,
            previousSpeeches,
            userProfile: params.userProfile,
          },
          signal,
          modelOverride,
        );

        if (!actionsResult.success || !actionsResult.scene) {
          if (actionsResult.error === 'INSUFFICIENT_CREDITS') {
            store.getState().setCreditsInsufficient(true);
          }
          log.warn(`[regenerateScene] actions generation failed for ${sceneId}`);
          return;
        }

        const newScene = actionsResult.scene;

        // TTS
        const settings = useSettingsStore.getState();
        if (settings.ttsEnabled && settings.ttsProviderId !== 'browser-native-tts') {
          const ttsResult = await generateTTSForScene(newScene, signal);
          if (!ttsResult.success) {
            log.warn(`[regenerateScene] TTS failed for ${sceneId}`);
            return;
          }
        }

        // Success — atomic in-place swap. Preserves array index (sidebar
        // order) and, if the old scene was current, transparently moves the
        // viewer to the new scene without any blank-page flash.
        const stillExists = store.getState().scenes.some((s) => s.id === sceneId);
        if (!stillExists) {
          // User deleted the scene while we were regenerating — just bail,
          // don't resurrect it.
          log.info(`[regenerateScene] scene ${sceneId} vanished during regen, discarding result`);
          return;
        }
        store.getState().replaceScene(sceneId, newScene);

        // Kick off media regeneration for this outline only. Orchestrator will
        // persist to MinIO (with elementId) and patch element srcs.
        generateMediaForOutlines([effectiveOutline], state.stage.id).catch((err) => {
          log.warn('[regenerateScene] Media regeneration error:', err);
        });
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          log.error('[regenerateScene] Failed:', err);
        }
      } finally {
        // Always clear the regenerating flag on the ORIGINAL id. If we
        // successfully replaced, replaceScene already cleared both old and
        // new; this call is a no-op in that case.
        store.getState().setSceneRegenerating(sceneId, false);
      }
    },
    [store],
  );

  return { generateRemaining, retrySingleOutline, regenerateScene, stop, isGenerating };
}
