'use client';

import { useEffect, useState, Suspense, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import {
  CheckCircle2,
  Sparkles,
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bot,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useStageStore } from '@/lib/store/stage';
import { useSettingsStore } from '@/lib/store/settings';
import { useAgentRegistry } from '@/lib/orchestration/registry/store';
import { getAvailableProvidersWithVoices } from '@/lib/audio/voice-resolver';
import { useI18n } from '@/lib/hooks/use-i18n';
import {
  loadImageMapping,
  loadPdfBlob,
  cleanupOldImages,
  storeImages,
} from '@/lib/utils/image-storage';
import { getCurrentModelConfig } from '@/lib/utils/model-config';
import { db } from '@/lib/utils/database';
import { MAX_PDF_CONTENT_CHARS, MAX_VISION_IMAGES } from '@/lib/constants/generation';
import { nanoid } from 'nanoid';
import type { Stage } from '@/lib/types/stage';
import type { SceneOutline, PdfImage, ImageMapping } from '@/lib/types/generation';
import { AgentRevealModal } from '@/components/agent/agent-reveal-modal';
import { createLogger } from '@/lib/logger';
import { type GenerationSessionState, ALL_STEPS, getActiveSteps } from './types';
import { StepVisualizer } from './components/visualizers';
import { OutlineEditor } from './components/outline-editor';
import { toast } from 'sonner';

const log = createLogger('GenerationPreview');

/** Thrown when API returns 402 / INSUFFICIENT_CREDITS — show recharge UI, not raw server message */
const INSUFFICIENT_CREDITS_MARKER = 'INSUFFICIENT_CREDITS';

function GenerationPreviewContent() {
  const router = useRouter();
  const { t } = useI18n();
  const hasStartedRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const [session, setSession] = useState<GenerationSessionState | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [insufficientCredits, setInsufficientCredits] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isComplete] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [streamingOutlines, setStreamingOutlines] = useState<SceneOutline[] | null>(null);
  const [truncationWarnings, setTruncationWarnings] = useState<string[]>([]);
  const [webSearchSources, setWebSearchSources] = useState<Array<{ title: string; url: string }>>(
    [],
  );
  const [showAgentReveal, setShowAgentReveal] = useState(false);
  const [generatedAgents, setGeneratedAgents] = useState<
    Array<{
      id: string;
      name: string;
      role: string;
      persona: string;
      avatar: string;
      color: string;
      priority: number;
    }>
  >([]);
  const agentRevealResolveRef = useRef<(() => void) | null>(null);

  // Outline-confirmation review state. When the user has opted into
  // "confirm before continue", generation pauses here after outlines stream
  // until the user clicks confirm. We also support full / per-card
  // regeneration with optional feedback.
  const [outlineReview, setOutlineReview] = useState<{
    status: 'idle' | 'awaiting' | 'regenerating-all' | 'regenerating-one';
    editing: SceneOutline[];
    regeneratingId: string | null;
    error: string | null;
  }>({ status: 'idle', editing: [], regeneratingId: null, error: null });
  const outlineConfirmResolveRef = useRef<((outlines: SceneOutline[]) => void) | null>(null);
  // Snapshot of generation context needed to call the regenerate endpoints.
  // Captured at the moment we enter the awaiting state so handlers (which run
  // outside of `startGeneration`) have everything they need without re-reading
  // session state asynchronously.
  const regenContextRef = useRef<{
    requirements: GenerationSessionState['requirements'];
    pdfText?: string;
    pdfImages?: GenerationSessionState['pdfImages'];
    imageMapping: ImageMapping;
    researchContext?: string;
    agents: Array<{ id: string; name: string; role: string; persona?: string }>;
  } | null>(null);

  // Compute active steps based on session state
  const activeSteps = getActiveSteps(session);

  const rechargeHref =
    process.env.NEXT_PUBLIC_CREDITS_RECHARGE_URL?.trim() || '/credits/recharge';
  const rechargeOpensNewTab = /^https?:\/\//i.test(rechargeHref);

  // Load session from sessionStorage
  useEffect(() => {
    cleanupOldImages(24).catch((e) => log.error(e));

    const saved = sessionStorage.getItem('generationSession');
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as GenerationSessionState;
        setSession(parsed);
      } catch (e) {
        log.error('Failed to parse generation session:', e);
      }
    }
    setSessionLoaded(true);
  }, []);

  // Abort all in-flight requests on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  // Get API credentials from localStorage
  const getApiHeaders = () => {
    const modelConfig = getCurrentModelConfig();
    const settings = useSettingsStore.getState();
    const imageProviderConfig = settings.imageProvidersConfig?.[settings.imageProviderId];
    const videoProviderConfig = settings.videoProvidersConfig?.[settings.videoProviderId];
    return {
      'Content-Type': 'application/json',
      'x-model': modelConfig.modelString,
      'x-api-key': modelConfig.apiKey,
      'x-base-url': modelConfig.baseUrl,
      'x-provider-type': modelConfig.providerType || '',
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
  };

  // Auto-start generation when session is loaded
  useEffect(() => {
    if (session && !hasStartedRef.current) {
      hasStartedRef.current = true;
      startGeneration();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // Main generation flow
  const startGeneration = async () => {
    if (!session) return;

    // Create AbortController for this generation run
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const signal = controller.signal;

    // Use a local mutable copy so we can update it after PDF parsing
    let currentSession = session;

    setError(null);
    setInsufficientCredits(false);
    setCurrentStepIndex(0);

    try {
      // Compute active steps for this session (recomputed after session mutations)
      let activeSteps = getActiveSteps(currentSession);

      // Determine if we need the PDF analysis step
      const hasPdfToAnalyze = !!currentSession.pdfStorageKey && !currentSession.pdfText;
      // If no PDF to analyze, skip to the next available step
      if (!hasPdfToAnalyze) {
        const firstNonPdfIdx = activeSteps.findIndex((s) => s.id !== 'pdf-analysis');
        setCurrentStepIndex(Math.max(0, firstNonPdfIdx));
      }

      // Step 0: Parse PDF if needed
      if (hasPdfToAnalyze) {
        log.debug('=== Generation Preview: Parsing PDF ===');
        const pdfBlob = await loadPdfBlob(currentSession.pdfStorageKey!);
        if (!pdfBlob) {
          throw new Error(t('generation.pdfLoadFailed'));
        }

        // Ensure pdfBlob is a valid Blob with content
        if (!(pdfBlob instanceof Blob) || pdfBlob.size === 0) {
          log.error('Invalid PDF blob:', {
            type: typeof pdfBlob,
            size: pdfBlob instanceof Blob ? pdfBlob.size : 'N/A',
          });
          throw new Error(t('generation.pdfLoadFailed'));
        }

        // Wrap as a File to guarantee multipart/form-data with correct content-type
        const pdfFile = new File([pdfBlob], currentSession.pdfFileName || 'document.pdf', {
          type: 'application/pdf',
        });

        const parseFormData = new FormData();
        parseFormData.append('pdf', pdfFile);

        if (currentSession.pdfProviderId) {
          parseFormData.append('providerId', currentSession.pdfProviderId);
        }
        if (currentSession.pdfProviderConfig?.apiKey?.trim()) {
          parseFormData.append('apiKey', currentSession.pdfProviderConfig.apiKey);
        }
        if (currentSession.pdfProviderConfig?.baseUrl?.trim()) {
          parseFormData.append('baseUrl', currentSession.pdfProviderConfig.baseUrl);
        }

        const submitResponse = await fetch('/api/parse-pdf/submit', {
          method: 'POST',
          body: parseFormData,
          signal,
        });

        if (!submitResponse.ok) {
          const errorData = await submitResponse.json();
          throw new Error(errorData.error || t('generation.pdfParseFailed'));
        }

        const submitResult = await submitResponse.json();
        if (!submitResult.success) {
          throw new Error(t('generation.pdfParseFailed'));
        }

        let parseResultData: Record<string, unknown>;

        if (submitResult.async) {
          // MinerU cloud — poll until done
          const { taskId, provider, apiBase } = submitResult;
          const POLL_INTERVAL_MS = 3000;
          const POLL_TIMEOUT_MS = 15 * 60 * 1000; // 15 min max
          const pollDeadline = Date.now() + POLL_TIMEOUT_MS;

          while (Date.now() < pollDeadline) {
            if (signal.aborted) throw new Error('Aborted');
            await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS));

            const pollRes = await fetch('/api/parse-pdf/poll', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ taskId, provider, apiBase }),
              signal,
            });

            if (!pollRes.ok) {
              const pollErr = await pollRes.json().catch(() => ({ error: 'Poll failed' }));
              throw new Error(pollErr.error || t('generation.pdfParseFailed'));
            }

            const pollResult = await pollRes.json();
            if (pollResult.status === 'failed') {
              throw new Error(pollResult.error || t('generation.pdfParseFailed'));
            }
            if (pollResult.status === 'done') {
              parseResultData = pollResult.data;
              break;
            }
            // status === 'processing' — continue polling
          }

          if (!parseResultData!) {
            throw new Error('PDF parsing timed out');
          }
        } else {
          // Synchronous provider (unpdf / MinerU self-hosted)
          if (!submitResult.data) {
            throw new Error(t('generation.pdfParseFailed'));
          }
          parseResultData = submitResult.data;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- API response shape is validated above
        const parseResult = { data: parseResultData as any };

        let pdfText = parseResult.data.text as string;

        // Truncate if needed
        if (pdfText.length > MAX_PDF_CONTENT_CHARS) {
          pdfText = pdfText.substring(0, MAX_PDF_CONTENT_CHARS);
        }

        // Create image metadata and store images
        // Prefer metadata.pdfImages (both parsers now return this)
        const rawPdfImages = parseResult.data.metadata?.pdfImages;
        const images = rawPdfImages
          ? rawPdfImages.map(
              (img: {
                id: string;
                src?: string;
                pageNumber?: number;
                description?: string;
                width?: number;
                height?: number;
              }) => ({
                id: img.id,
                src: img.src || '',
                pageNumber: img.pageNumber || 1,
                description: img.description,
                width: img.width,
                height: img.height,
              }),
            )
          : (parseResult.data.images as string[]).map((src: string, i: number) => ({
              id: `img_${i + 1}`,
              src,
              pageNumber: 1,
            }));

        const imageStorageIds = await storeImages(images);

        const pdfImages: PdfImage[] = images.map(
          (
            img: {
              id: string;
              src: string;
              pageNumber: number;
              description?: string;
              width?: number;
              height?: number;
            },
            i: number,
          ) => ({
            id: img.id,
            src: '',
            pageNumber: img.pageNumber,
            description: img.description,
            width: img.width,
            height: img.height,
            storageId: imageStorageIds[i],
          }),
        );

        // Update session with parsed PDF data
        const updatedSession = {
          ...currentSession,
          pdfText,
          pdfImages,
          imageStorageIds,
          pdfStorageKey: undefined, // Clear so we don't re-parse
        };
        setSession(updatedSession);
        sessionStorage.setItem('generationSession', JSON.stringify(updatedSession));

        // Truncation warnings
        const warnings: string[] = [];
        if ((parseResult.data.text as string).length > MAX_PDF_CONTENT_CHARS) {
          warnings.push(t('generation.textTruncated', { n: MAX_PDF_CONTENT_CHARS }));
        }
        if (images.length > MAX_VISION_IMAGES) {
          warnings.push(
            t('generation.imageTruncated', { total: images.length, max: MAX_VISION_IMAGES }),
          );
        }
        if (warnings.length > 0) {
          setTruncationWarnings(warnings);
        }

        // Reassign local reference for subsequent steps
        currentSession = updatedSession;
        activeSteps = getActiveSteps(currentSession);
      }

      // ── Parallel: Web Search + Agent Generation ──────────────────────────
      // These two operations are independent, so we run them concurrently.
      // Web search depends on: requirement + pdfText
      // Agent generation depends on: stage name + settings
      // Neither depends on the other's output, saving ~3-8s.

      // Load imageMapping early (needed for both outline and scene generation)
      let imageMapping: ImageMapping = {};
      if (currentSession.imageStorageIds && currentSession.imageStorageIds.length > 0) {
        log.debug('Loading images from IndexedDB');
        imageMapping = await loadImageMapping(currentSession.imageStorageIds);
      } else if (
        currentSession.imageMapping &&
        Object.keys(currentSession.imageMapping).length > 0
      ) {
        log.debug('Using imageMapping from session (old format)');
        imageMapping = currentSession.imageMapping;
      }

      const settings = useSettingsStore.getState();
      let agents: Array<{
        id: string;
        name: string;
        role: string;
        persona?: string;
      }> = [];

      // Create stage client-side (needed for agent generation stageId)
      const stageId = nanoid(10);
      const stage: Stage = {
        id: stageId,
        name: extractTopicFromRequirement(currentSession.requirements.requirement),
        description: '',
        language: currentSession.requirements.language || 'zh-CN',
        style: 'professional',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      // ── Build web search promise (non-blocking) ──
      const webSearchPromise = (async () => {
        const webSearchStepIdx = activeSteps.findIndex((s) => s.id === 'web-search');
        if (!currentSession.requirements.webSearch || webSearchStepIdx < 0) return null;
        setCurrentStepIndex(webSearchStepIdx);
        setWebSearchSources([]);

        const wsSettings = useSettingsStore.getState();
        const wsApiKey =
          wsSettings.webSearchProvidersConfig?.[wsSettings.webSearchProviderId]?.apiKey;
        const res = await fetch('/api/web-search', {
          method: 'POST',
          headers: getApiHeaders(),
          body: JSON.stringify({
            query: currentSession.requirements.requirement,
            pdfText: currentSession.pdfText || undefined,
            apiKey: wsApiKey || undefined,
          }),
          signal,
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: 'Web search failed' }));
          if (res.status === 402 || data.code === 'INSUFFICIENT_CREDITS') {
            throw new Error(INSUFFICIENT_CREDITS_MARKER);
          }
          throw new Error(data.error || t('generation.webSearchFailed'));
        }

        const searchData = await res.json();
        const sources = (searchData.sources || []).map((s: { title: string; url: string }) => ({
          title: s.title,
          url: s.url,
        }));
        setWebSearchSources(sources);
        return { context: searchData.context || '', sources };
      })();

      // ── Build agent generation promise (non-blocking) ──
      const agentPromise = (async () => {
        if (settings.agentMode !== 'auto') return null; // handled below for preset mode

        const agentStepIdx = activeSteps.findIndex((s) => s.id === 'agent-generation');
        if (agentStepIdx >= 0) setCurrentStepIndex(agentStepIdx);

        const allAvatars = [
          {
            path: '/avatars/teacher.png',
            desc: 'Male teacher with glasses, holding a book, green background',
          },
          {
            path: '/avatars/assist.png',
            desc: 'Young female assistant with glasses, pink background, friendly smile',
          },
          {
            path: '/avatars/clown.png',
            desc: 'Playful girl with curly hair doing rock gesture, blue shirt, humorous vibe',
          },
          {
            path: '/avatars/curious.png',
            desc: 'Surprised boy with glasses, hand on cheek, curious expression',
          },
          {
            path: '/avatars/note-taker.png',
            desc: 'Studious boy with glasses, blue shirt, calm and organized',
          },
          {
            path: '/avatars/thinker.png',
            desc: 'Thoughtful girl with hand on chin, purple background, contemplative',
          },
        ];

        const getAvailableVoicesForGeneration = () => {
          const providers = getAvailableProvidersWithVoices(settings.ttsProvidersConfig);
          return providers.flatMap((p) =>
            p.voices.map((v) => ({
              providerId: p.providerId,
              voiceId: v.id,
              voiceName: v.name,
            })),
          );
        };

        const agentResp = await fetch('/api/generate/agent-profiles', {
          method: 'POST',
          headers: getApiHeaders(),
          body: JSON.stringify({
            stageInfo: { name: stage.name, description: stage.description },
            language: currentSession.requirements.language || 'zh-CN',
            availableAvatars: allAvatars.map((a) => a.path),
            avatarDescriptions: allAvatars.map((a) => ({ path: a.path, desc: a.desc })),
            availableVoices: getAvailableVoicesForGeneration(),
          }),
          signal,
        });

        if (!agentResp.ok) {
          const errData = await agentResp.json().catch(() => ({}));
          if (agentResp.status === 402 || errData.code === 'INSUFFICIENT_CREDITS') {
            throw new Error(INSUFFICIENT_CREDITS_MARKER);
          }
          throw new Error(errData.error || 'Agent generation failed');
        }
        const agentData = await agentResp.json();
        if (!agentData.success) throw new Error(agentData.error || 'Agent generation failed');
        return agentData;
      })();

      // ── Await both in parallel ──
      const [webSearchResult, agentResult] = await Promise.all([
        webSearchPromise,
        agentPromise.catch((err: unknown) => {
          // Agent generation failure is non-fatal (falls back to presets)
          if (err instanceof Error && err.message === INSUFFICIENT_CREDITS_MARKER) throw err;
          log.warn('[Generation] Agent generation failed, falling back to presets:', err);
          return null;
        }),
      ]);

      // ── Merge web search result ──
      if (webSearchResult) {
        const updatedSessionWithSearch = {
          ...currentSession,
          researchContext: webSearchResult.context,
          researchSources: webSearchResult.sources,
        };
        setSession(updatedSessionWithSearch);
        sessionStorage.setItem('generationSession', JSON.stringify(updatedSessionWithSearch));
        currentSession = updatedSessionWithSearch;
        activeSteps = getActiveSteps(currentSession);
      }

      // ── Merge agent result ──
      if (settings.agentMode === 'auto' && agentResult) {
        try {
          const { saveGeneratedAgents } = await import('@/lib/orchestration/registry/store');
          const savedIds = await saveGeneratedAgents(stage.id, agentResult.agents);
          settings.setSelectedAgentIds(savedIds);
          stage.agentIds = savedIds;

          // Show card-reveal modal, continue generation once all cards are revealed
          setGeneratedAgents(agentResult.agents);
          setShowAgentReveal(true);
          await new Promise<void>((resolve) => {
            agentRevealResolveRef.current = resolve;
          });

          agents = savedIds
            .map((id) => useAgentRegistry.getState().getAgent(id))
            .filter(Boolean)
            .map((a) => ({
              id: a!.id,
              name: a!.name,
              role: a!.role,
              persona: a!.persona,
            }));
        } catch (err: unknown) {
          if (err instanceof Error && err.message === INSUFFICIENT_CREDITS_MARKER) throw err;
          log.warn('[Generation] Agent save failed, falling back to presets:', err);
          // Fall through to preset fallback below
        }
      }

      // Fallback: preset agents or failed auto-generation
      if (agents.length === 0) {
        const registry = useAgentRegistry.getState();
        const fallbackIds = settings.selectedAgentIds.filter((id) => {
          const a = registry.getAgent(id);
          return a && !a.isGenerated;
        });
        agents = fallbackIds
          .map((id) => registry.getAgent(id))
          .filter(Boolean)
          .map((a) => ({
            id: a!.id,
            name: a!.name,
            role: a!.role,
            persona: a!.persona,
          }));
        stage.agentIds = fallbackIds;
      }

      // ── Generate outlines (with agent personas for teacher context) ──
      let outlines = currentSession.sceneOutlines;

      const outlineStepIdx = activeSteps.findIndex((s) => s.id === 'outline');
      setCurrentStepIndex(outlineStepIdx >= 0 ? outlineStepIdx : 0);
      if (!outlines || outlines.length === 0) {
        log.debug('=== Generating outlines (SSE) ===');
        setStreamingOutlines([]);

        outlines = await new Promise<SceneOutline[]>((resolve, reject) => {
          const collected: SceneOutline[] = [];

          fetch('/api/generate/scene-outlines-stream', {
            method: 'POST',
            headers: getApiHeaders(),
            body: JSON.stringify({
              requirements: currentSession.requirements,
              pdfText: currentSession.pdfText,
              pdfImages: currentSession.pdfImages,
              imageMapping,
              researchContext: currentSession.researchContext,
              agents,
            }),
            signal,
          })
            .then((res) => {
              if (!res.ok) {
                return res.json().then((d) => {
                  if (res.status === 402 || d.code === 'INSUFFICIENT_CREDITS') {
                    reject(new Error(INSUFFICIENT_CREDITS_MARKER));
                    return;
                  }
                  reject(new Error(d.error || t('generation.outlineGenerateFailed')));
                });
              }

              const reader = res.body?.getReader();
              if (!reader) {
                reject(new Error(t('generation.streamNotReadable')));
                return;
              }

              const decoder = new TextDecoder();
              let sseBuffer = '';

              const pump = (): Promise<void> =>
                reader.read().then(({ done, value }) => {
                  if (value) {
                    sseBuffer += decoder.decode(value, { stream: !done });
                    const lines = sseBuffer.split('\n');
                    sseBuffer = lines.pop() || '';

                    for (const line of lines) {
                      if (!line.startsWith('data: ')) continue;
                      try {
                        const evt = JSON.parse(line.slice(6));
                        if (evt.type === 'outline') {
                          collected.push(evt.data);
                          setStreamingOutlines([...collected]);
                        } else if (evt.type === 'retry') {
                          collected.length = 0;
                          setStreamingOutlines([]);
                          setStatusMessage(t('generation.outlineRetrying'));
                        } else if (evt.type === 'done') {
                          resolve(evt.outlines || collected);
                          return;
                        } else if (evt.type === 'error') {
                          reject(new Error(evt.error));
                          return;
                        }
                      } catch (e) {
                        log.error('Failed to parse outline SSE:', line, e);
                      }
                    }
                  }
                  if (done) {
                    if (collected.length > 0) {
                      resolve(collected);
                    } else {
                      reject(new Error(t('generation.outlineEmptyResponse')));
                    }
                    return;
                  }
                  return pump();
                });

              pump().catch(reject);
            })
            .catch(reject);
        });

        const updatedSession = { ...currentSession, sceneOutlines: outlines };
        setSession(updatedSession);
        sessionStorage.setItem('generationSession', JSON.stringify(updatedSession));
        currentSession = updatedSession;

        // Outline generation succeeded — clear homepage draft cache
        try {
          localStorage.removeItem('requirementDraft');
        } catch {
          /* ignore */
        }

        if (currentSession.outlineConfirmEnabled) {
          // Stash the inputs each regenerate handler will need so they can
          // execute outside this async function.
          regenContextRef.current = {
            requirements: currentSession.requirements,
            pdfText: currentSession.pdfText,
            pdfImages: currentSession.pdfImages,
            imageMapping,
            researchContext: currentSession.researchContext,
            agents,
          };

          setStreamingOutlines(null);
          setStatusMessage(t('generation.outlineAwaitConfirmDesc'));
          setOutlineReview({
            status: 'awaiting',
            editing: outlines,
            regeneratingId: null,
            error: null,
          });

          // Block until the user confirms (handler resolves with the final list).
          outlines = await new Promise<SceneOutline[]>((resolve) => {
            outlineConfirmResolveRef.current = resolve;
          });

          // Persist confirmed outlines to session/state so a refresh can resume.
          const confirmedSession = { ...currentSession, sceneOutlines: outlines };
          setSession(confirmedSession);
          sessionStorage.setItem('generationSession', JSON.stringify(confirmedSession));
          currentSession = confirmedSession;
          setOutlineReview({
            status: 'idle',
            editing: [],
            regeneratingId: null,
            error: null,
          });
          setStatusMessage('');
        } else {
          // Original behavior: brief pause to let user see the final outline state
          await new Promise((resolve) => setTimeout(resolve, 800));
        }
      }

      // Move to scene generation step
      setStatusMessage('');
      if (!outlines || outlines.length === 0) {
        throw new Error(t('generation.outlineEmptyResponse'));
      }

      // Store stage and outlines
      const store = useStageStore.getState();
      store.setStage(stage);
      store.setOutlines(outlines);

      // Advance to slide-content step
      const contentStepIdx = activeSteps.findIndex((s) => s.id === 'slide-content');
      if (contentStepIdx >= 0) setCurrentStepIndex(contentStepIdx);

      // Build stageInfo and userProfile for API call
      const stageInfo = {
        name: stage.name,
        description: stage.description,
        language: stage.language,
        style: stage.style,
      };

      const userProfile =
        currentSession.requirements.userNickname || currentSession.requirements.userBio
          ? `Student: ${currentSession.requirements.userNickname || 'Unknown'}${currentSession.requirements.userBio ? ` — ${currentSession.requirements.userBio}` : ''}`
          : undefined;

      // Generate ONLY the first scene
      store.setGeneratingOutlines(outlines);

      const firstOutline = outlines[0];

      // Step 2: Generate content (currentStepIndex is already 2)
      const contentResp = await fetch('/api/generate/scene-content', {
        method: 'POST',
        headers: getApiHeaders(),
        body: JSON.stringify({
          outline: firstOutline,
          allOutlines: outlines,
          pdfImages: currentSession.pdfImages,
          imageMapping,
          stageInfo,
          stageId: stage.id,
          agents,
        }),
        signal,
      });

      if (!contentResp.ok) {
        const errorData = await contentResp.json().catch(() => ({ error: 'Request failed' }));
        if (contentResp.status === 402 || errorData.code === 'INSUFFICIENT_CREDITS') {
          throw new Error(INSUFFICIENT_CREDITS_MARKER);
        }
        throw new Error(errorData.error || t('generation.sceneGenerateFailed'));
      }

      const contentData = await contentResp.json();
      if (!contentData.success || !contentData.content) {
        throw new Error(contentData.error || t('generation.sceneGenerateFailed'));
      }

      // Generate actions (activate actions step indicator)
      const actionsStepIdx = activeSteps.findIndex((s) => s.id === 'actions');
      setCurrentStepIndex(actionsStepIdx >= 0 ? actionsStepIdx : currentStepIndex + 1);

      const actionsResp = await fetch('/api/generate/scene-actions', {
        method: 'POST',
        headers: getApiHeaders(),
        body: JSON.stringify({
          outline: contentData.effectiveOutline || firstOutline,
          allOutlines: outlines,
          content: contentData.content,
          stageId: stage.id,
          agents,
          previousSpeeches: [],
          userProfile,
        }),
        signal,
      });

      if (!actionsResp.ok) {
        const errorData = await actionsResp.json().catch(() => ({ error: 'Request failed' }));
        if (actionsResp.status === 402 || errorData.code === 'INSUFFICIENT_CREDITS') {
          throw new Error(INSUFFICIENT_CREDITS_MARKER);
        }
        throw new Error(errorData.error || t('generation.sceneGenerateFailed'));
      }

      const data = await actionsResp.json();
      if (!data.success || !data.scene) {
        throw new Error(data.error || t('generation.sceneGenerateFailed'));
      }

      // Generate TTS for first scene — concurrent batch (max 3 parallel)
      // pendingTtsUploads collects (audioId, blob, format) pairs for MinIO upload after addScene.
      const pendingTtsUploads: Array<{ audioId: string; blob: Blob; format: string }> = [];
      if (settings.ttsEnabled && settings.ttsProviderId !== 'browser-native-tts') {
        const ttsProviderConfig = settings.ttsProvidersConfig?.[settings.ttsProviderId];
        const speechActions = (data.scene.actions || []).filter(
          (a: { type: string; text?: string }) => a.type === 'speech' && a.text,
        );

        // Assign audioIds first (must be done before parallel fetch)
        for (const action of speechActions) {
          action.audioId = `tts_${action.id}`;
        }

        const TTS_CONCURRENCY = 3;
        let ttsFailCount = 0;

        // Process in batches of TTS_CONCURRENCY
        for (let i = 0; i < speechActions.length; i += TTS_CONCURRENCY) {
          const batch = speechActions.slice(i, i + TTS_CONCURRENCY);
          const results = await Promise.allSettled(
            batch.map(async (action: { id: string; text: string; audioId: string }) => {
              const audioId = action.audioId;
              const resp = await fetch('/api/generate/tts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  text: action.text,
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
              if (!resp.ok) {
                const errData = await resp.json().catch(() => ({}));
                if (resp.status === 402 || errData.code === 'INSUFFICIENT_CREDITS') {
                  throw new Error(INSUFFICIENT_CREDITS_MARKER);
                }
                throw new Error(errData.error || 'TTS failed');
              }
              const ttsData = await resp.json();
              if (!ttsData.success) throw new Error('TTS failed');
              const binary = atob(ttsData.base64);
              const bytes = new Uint8Array(binary.length);
              for (let j = 0; j < binary.length; j++) bytes[j] = binary.charCodeAt(j);
              const blob = new Blob([bytes], { type: `audio/${ttsData.format}` });
              await db.audioFiles.put({
                id: audioId,
                blob,
                format: ttsData.format,
                createdAt: Date.now(),
              });
              pendingTtsUploads.push({ audioId, blob, format: ttsData.format });
            }),
          );

          for (const r of results) {
            if (r.status === 'rejected') {
              if (r.reason?.message === INSUFFICIENT_CREDITS_MARKER) {
                throw new Error(INSUFFICIENT_CREDITS_MARKER);
              }
              log.warn('[TTS] Batch item failed:', r.reason);
              ttsFailCount++;
            }
          }
        }

        if (ttsFailCount > 0 && speechActions.length > 0) {
          throw new Error(t('generation.speechFailed'));
        }
      }

      // Add scene to store and navigate
      store.addScene(data.scene);
      store.setCurrentSceneId(data.scene.id);

      // Upload first-scene TTS blobs to MinIO and write back the URL into the speech action.
      // This mirrors what generateAndStoreTTS does for subsequent scenes (use-scene-generator),
      // ensuring shared-link users (who have no local IndexedDB) can play audio via audioUrl.
      if (pendingTtsUploads.length > 0) {
        import('@/lib/sync/classroom-sync').then(({ uploadMediaToServer }) => {
          for (const { audioId, blob, format } of pendingTtsUploads) {
            uploadMediaToServer(stage.id, 'tts', blob, `${audioId}.${format}`, audioId)
              .then((result) => {
                if (result?.url) {
                  store.updateSpeechActionAudioUrl(audioId, result.url);
                }
              })
              .catch(() => {});
          }
        });
      }

      // Set remaining outlines as skeleton placeholders
      const remaining = outlines.filter((o) => o.order !== data.scene.order);
      store.setGeneratingOutlines(remaining);

      // Store generation params for classroom to continue generation
      sessionStorage.setItem(
        'generationParams',
        JSON.stringify({
          pdfImages: currentSession.pdfImages,
          agents,
          userProfile,
        }),
      );

      sessionStorage.removeItem('generationSession');
      await store.saveToStorage();
      router.push(`/classroom/${stage.id}`);
    } catch (err) {
      // AbortError is expected when navigating away — don't show as error
      if (err instanceof DOMException && err.name === 'AbortError') {
        log.info('[GenerationPreview] Generation aborted');
        return;
      }
      sessionStorage.removeItem('generationSession');
      if (err instanceof Error && err.message === INSUFFICIENT_CREDITS_MARKER) {
        setInsufficientCredits(true);
        setError(null);
      } else {
        setInsufficientCredits(false);
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  };

  // ── Outline review handlers (only active in 'awaiting' state) ──────────

  const handleOutlineEditChange = (next: SceneOutline[]) => {
    setOutlineReview((prev) =>
      prev.status === 'idle'
        ? prev
        : { ...prev, editing: next, error: null },
    );
  };

  const handleConfirmOutlines = () => {
    setOutlineReview((prev) => {
      const finalOutlines = prev.editing;
      // Resolve the awaiting promise inside startGeneration() so the rest of
      // the pipeline picks up the user-confirmed outlines.
      outlineConfirmResolveRef.current?.(finalOutlines);
      outlineConfirmResolveRef.current = null;
      return { status: 'idle', editing: [], regeneratingId: null, error: null };
    });
  };

  const handleRegenerateAll = async (feedback: string) => {
    const ctx = regenContextRef.current;
    if (!ctx) return;
    const previous = outlineReview.editing;
    setOutlineReview((prev) => ({ ...prev, status: 'regenerating-all', error: null }));
    setStreamingOutlines([]);
    setStatusMessage(t('generation.outlineRegenerating'));

    try {
      const collected = await new Promise<SceneOutline[]>((resolve, reject) => {
        const buffer: SceneOutline[] = [];
        fetch('/api/generate/scene-outlines-stream', {
          method: 'POST',
          headers: getApiHeaders(),
          body: JSON.stringify({
            requirements: ctx.requirements,
            pdfText: ctx.pdfText,
            pdfImages: ctx.pdfImages,
            imageMapping: ctx.imageMapping,
            researchContext: ctx.researchContext,
            agents: ctx.agents,
            userFeedback: feedback,
            previousOutlines: previous,
          }),
          signal: abortControllerRef.current?.signal,
        })
          .then((res) => {
            if (!res.ok) {
              return res.json().then((d) => {
                if (res.status === 402 || d.code === 'INSUFFICIENT_CREDITS') {
                  reject(new Error(INSUFFICIENT_CREDITS_MARKER));
                  return;
                }
                reject(new Error(d.error || t('generation.outlineGenerateFailed')));
              });
            }
            const reader = res.body?.getReader();
            if (!reader) {
              reject(new Error(t('generation.streamNotReadable')));
              return;
            }
            const decoder = new TextDecoder();
            let sseBuffer = '';
            const pump = (): Promise<void> =>
              reader.read().then(({ done, value }) => {
                if (value) {
                  sseBuffer += decoder.decode(value, { stream: !done });
                  const lines = sseBuffer.split('\n');
                  sseBuffer = lines.pop() || '';
                  for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    try {
                      const evt = JSON.parse(line.slice(6));
                      if (evt.type === 'outline') {
                        buffer.push(evt.data);
                        setStreamingOutlines([...buffer]);
                      } else if (evt.type === 'retry') {
                        buffer.length = 0;
                        setStreamingOutlines([]);
                      } else if (evt.type === 'done') {
                        resolve(evt.outlines || buffer);
                        return;
                      } else if (evt.type === 'error') {
                        reject(new Error(evt.error));
                        return;
                      }
                    } catch (e) {
                      log.error('Failed to parse outline SSE:', line, e);
                    }
                  }
                }
                if (done) {
                  if (buffer.length > 0) resolve(buffer);
                  else reject(new Error(t('generation.outlineEmptyResponse')));
                  return;
                }
                return pump();
              });
            pump().catch(reject);
          })
          .catch(reject);
      });

      setOutlineReview({
        status: 'awaiting',
        editing: collected,
        regeneratingId: null,
        error: null,
      });
      setStreamingOutlines(null);
      setStatusMessage(t('generation.outlineAwaitConfirmDesc'));
      toast.success(t('generation.outlineRegeneratedAll'));
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const message =
        err instanceof Error
          ? err.message === INSUFFICIENT_CREDITS_MARKER
            ? t('generation.insufficientCreditsTitle')
            : err.message
          : t('generation.outlineGenerateFailed');
      log.error('Regenerate-all failed:', err);
      // Restore previous editing list so the user does not lose their work.
      setOutlineReview({
        status: 'awaiting',
        editing: previous,
        regeneratingId: null,
        error: message,
      });
      setStreamingOutlines(null);
      setStatusMessage(t('generation.outlineAwaitConfirmDesc'));
      toast.error(message);
    }
  };

  const handleRegenerateOne = async (outlineId: string, feedback: string) => {
    const ctx = regenContextRef.current;
    if (!ctx) return;
    const target = outlineReview.editing.find((o) => o.id === outlineId);
    if (!target) return;

    setOutlineReview((prev) => ({
      ...prev,
      status: 'regenerating-one',
      regeneratingId: outlineId,
      error: null,
    }));

    try {
      const resp = await fetch('/api/generate/scene-outline-single', {
        method: 'POST',
        headers: getApiHeaders(),
        body: JSON.stringify({
          requirements: ctx.requirements,
          pdfText: ctx.pdfText,
          pdfImages: ctx.pdfImages,
          imageMapping: ctx.imageMapping,
          researchContext: ctx.researchContext,
          agents: ctx.agents,
          targetOutline: target,
          allOutlines: outlineReview.editing,
          userFeedback: feedback,
        }),
        signal: abortControllerRef.current?.signal,
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        if (resp.status === 402 || errData.code === 'INSUFFICIENT_CREDITS') {
          throw new Error(INSUFFICIENT_CREDITS_MARKER);
        }
        throw new Error(errData.error || t('generation.outlineGenerateFailed'));
      }

      const data = await resp.json();
      if (!data.success || !data.outline) {
        throw new Error(t('generation.outlineGenerateFailed'));
      }

      setOutlineReview((prev) => ({
        status: 'awaiting',
        editing: prev.editing.map((o) => (o.id === outlineId ? data.outline : o)),
        regeneratingId: null,
        error: null,
      }));
      toast.success(t('generation.outlineRegeneratedOne'));
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const message =
        err instanceof Error
          ? err.message === INSUFFICIENT_CREDITS_MARKER
            ? t('generation.insufficientCreditsTitle')
            : err.message
          : t('generation.outlineGenerateFailed');
      log.error('Regenerate-one failed:', err);
      setOutlineReview((prev) => ({
        ...prev,
        status: 'awaiting',
        regeneratingId: null,
        error: message,
      }));
      toast.error(message);
    }
  };

  const extractTopicFromRequirement = (requirement: string): string => {
    const trimmed = requirement.trim();
    if (trimmed.length <= 500) {
      return trimmed;
    }
    return trimmed.substring(0, 500).trim() + '...';
  };

  const goBackToHome = () => {
    abortControllerRef.current?.abort();
    // Drop any pending outline-confirm gate so startGeneration can settle cleanly.
    outlineConfirmResolveRef.current = null;
    sessionStorage.removeItem('generationSession');
    router.push('/');
  };

  // Still loading session from sessionStorage
  if (!sessionLoaded) {
    return (
      <div className="min-h-[100dvh] w-full bg-gradient-to-br from-slate-50 via-violet-50/40 to-slate-100 dark:from-slate-950 dark:via-violet-950/20 dark:to-slate-900 flex items-center justify-center p-4">
        <div className="text-center text-muted-foreground">
          <div className="size-8 border-2 border-violet-500/30 border-t-violet-600 dark:border-t-violet-500 rounded-full animate-spin mx-auto" />
        </div>
      </div>
    );
  }

  // No session found
  if (!session) {
    return (
      <div className="min-h-[100dvh] w-full bg-gradient-to-br from-slate-50 via-violet-50/40 to-slate-100 dark:from-slate-950 dark:via-violet-950/20 dark:to-slate-900 flex items-center justify-center p-4 relative overflow-hidden">
        {/* Background Decor */}
        <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-violet-500/10 rounded-full blur-[100px] animate-pulse" style={{ animationDuration: '4s' }} />
        </div>
        <Card className="p-8 max-w-md w-full relative z-10 border-violet-100 dark:border-violet-900/50 shadow-xl shadow-violet-500/5 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl">
          <div className="text-center space-y-5">
            <div className="size-16 rounded-2xl bg-violet-50 dark:bg-violet-500/10 flex items-center justify-center mx-auto mb-2">
              <AlertCircle className="size-8 text-violet-500" />
            </div>
            <div>
              <h2 className="text-xl font-bold tracking-tight">{t('generation.sessionNotFound')}</h2>
              <p className="text-sm text-muted-foreground mt-2">{t('generation.sessionNotFoundDesc')}</p>
            </div>
            <Button onClick={() => router.push('/')} className="w-full bg-violet-600 hover:bg-violet-700 text-white shadow-md shadow-violet-500/20">
              <ArrowLeft className="size-4 mr-2" />
              {t('generation.backToHome')}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const activeStep =
    activeSteps.length > 0
      ? activeSteps[Math.min(currentStepIndex, activeSteps.length - 1)]
      : ALL_STEPS[0];

  return (
    <div className="min-h-[100dvh] w-full bg-slate-50 dark:bg-slate-950 flex relative overflow-hidden">
      {/* Blueprint Grid Background */}
      <div 
        className="fixed inset-0 pointer-events-none z-0 opacity-[0.03] dark:opacity-[0.05]" 
        style={{ 
          backgroundImage: 'linear-gradient(to right, #8b5cf6 1px, transparent 1px), linear-gradient(to bottom, #8b5cf6 1px, transparent 1px)', 
          backgroundSize: '32px 32px' 
        }} 
      />

      {/* Background Orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <div
          className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-violet-500/20 dark:bg-violet-500/10 rounded-full blur-[120px] animate-pulse"
          style={{ animationDuration: '7s' }}
        />
        <div
          className="absolute bottom-[-10%] right-[-10%] w-[600px] h-[600px] bg-fuchsia-500/20 dark:bg-fuchsia-500/10 rounded-full blur-[150px] animate-pulse"
          style={{ animationDuration: '10s' }}
        />
      </div>

      {/* Back button */}
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        className="absolute top-6 left-6 z-30"
      >
        <Button variant="ghost" size="sm" onClick={goBackToHome} className="hover:bg-violet-100 dark:hover:bg-violet-900/30 text-slate-600 dark:text-slate-300">
          <ArrowLeft className="size-4 mr-2" />
          {t('generation.backToHome')}
        </Button>
      </motion.div>

      {/* Main Layout Container */}
      <div className="z-10 flex w-full h-[100dvh] pt-20 pb-8 px-8 gap-8 max-w-[1800px] mx-auto">
        
        {/* Left Sidebar: Timeline & Status */}
        <motion.div
          initial={{ opacity: 0, x: -30 }}
          animate={{ opacity: 1, x: 0 }}
          className="w-[350px] shrink-0 flex flex-col h-full bg-white/70 dark:bg-slate-900/70 backdrop-blur-3xl rounded-3xl border border-violet-200/50 dark:border-violet-800/30 shadow-2xl shadow-violet-900/10 p-8 relative overflow-hidden ring-1 ring-white/50 dark:ring-white/5"
        >
          {/* Header Text */}
          <div className="mb-8 relative z-10">
            <AnimatePresence mode="wait">
              <motion.div
                key={
                  error || insufficientCredits
                    ? 'error'
                    : isComplete
                      ? 'done'
                      : outlineReview.status === 'awaiting'
                        ? 'outline-awaiting'
                        : activeStep.id
                }
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 mb-2">
                  {insufficientCredits
                    ? t('generation.insufficientCreditsTitle')
                    : error
                      ? t('generation.generationFailed')
                      : isComplete
                        ? t('generation.generationComplete')
                        : outlineReview.status === 'awaiting'
                          ? t('generation.outlineAwaitConfirm')
                          : t(activeStep.title)}
                </h2>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {insufficientCredits
                    ? t('generation.insufficientCreditsDesc')
                    : error
                      ? error
                      : isComplete
                        ? t('generation.classroomReady')
                        : outlineReview.status === 'awaiting'
                          ? t('generation.outlineAwaitConfirmDesc')
                          : statusMessage || t(activeStep.description)}
                </p>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Timeline - Maps over activeSteps to ensure indices match exactly */}
          <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-6 relative z-10">
            <div className="absolute left-[11px] top-3 bottom-3 w-0.5 bg-violet-100 dark:bg-violet-900/50 z-0" />
            
            {activeSteps.map((step, idx) => {
              const isActive = idx === currentStepIndex && !isComplete && !error && !insufficientCredits;
              const isPast = idx < currentStepIndex || isComplete;
              
              return (
                <div key={step.id} className="relative z-10 flex items-start gap-4">
                  <div className={cn(
                    "mt-1 size-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors duration-500 bg-white dark:bg-slate-900",
                    isActive ? "border-violet-600 dark:border-violet-500 shadow-[0_0_10px_rgba(124,58,237,0.4)]" :
                    isPast ? "border-violet-400 dark:border-violet-600" :
                    "border-slate-200 dark:border-slate-800"
                  )}>
                    {isPast && <CheckCircle2 className="size-3 text-violet-500" />}
                    {isActive && <div className="size-2 rounded-full bg-violet-600 dark:bg-violet-500 animate-pulse" />}
                  </div>
                  <div className={cn(
                    "transition-all duration-500",
                    isActive ? "opacity-100 translate-x-1" : "opacity-50 hover:opacity-70"
                  )}>
                    <h4 className={cn("text-sm font-semibold", isActive ? "text-violet-700 dark:text-violet-300" : "text-foreground")}>
                      {t(step.title)}
                    </h4>
                    {isActive && (
                      <p className="text-xs text-muted-foreground mt-0.5 max-w-[90%] leading-snug">
                        {t(step.description)}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer Action Area */}
          <div className="mt-6 pt-6 border-t border-violet-100/50 dark:border-violet-900/30 flex flex-col gap-4 relative z-10">
            <AnimatePresence mode="popLayout">
              {error || insufficientCredits ? (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="w-full flex flex-col gap-3"
                >
                  {insufficientCredits && (
                    <Button className="w-full bg-violet-600 hover:bg-violet-700 text-white" asChild>
                      {rechargeOpensNewTab ? (
                        <a href={rechargeHref} target="_blank" rel="noopener noreferrer">
                          {t('generation.goToRecharge')} <ArrowRight className="size-4 ml-2" />
                        </a>
                      ) : (
                        <Link href={rechargeHref}>
                          {t('generation.goToRecharge')} <ArrowRight className="size-4 ml-2" />
                        </Link>
                      )}
                    </Button>
                  )}
                  <Button variant="outline" className="w-full" onClick={goBackToHome}>
                    {t('generation.goBackAndRetry')}
                  </Button>
                </motion.div>
              ) : !isComplete ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="w-full flex flex-col gap-4"
                >
                  <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-violet-500/10 border border-violet-500/20 text-sm font-medium text-violet-700 dark:text-violet-300 shadow-sm w-full justify-center">
                    <Sparkles className="size-4 animate-pulse text-violet-500" />
                    <span>{t('generation.aiWorking')}</span>
                  </div>

                  <div className="flex items-center justify-between w-full">
                    {/* Truncation warning indicator */}
                    {truncationWarnings.length > 0 ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="size-9 rounded-full flex items-center justify-center cursor-default bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 transition-colors"
                          >
                            <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" align="start" className="bg-white/95 dark:bg-slate-800/95 backdrop-blur-md border-amber-200 dark:border-amber-800/50 max-w-xs">
                          <div className="space-y-1 py-1">
                            {truncationWarnings.map((w, i) => (
                              <p key={i} className="text-xs leading-relaxed text-slate-700 dark:text-slate-200">
                                {w}
                              </p>
                            ))}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    ) : <div />}

                    {generatedAgents.length > 0 && !showAgentReveal && (
                      <button
                        onClick={() => setShowAgentReveal(true)}
                        className="flex items-center gap-2 rounded-full border border-violet-300/40 bg-white/80 dark:bg-slate-800/80 px-4 py-2 text-sm font-medium text-violet-600 dark:text-violet-400 shadow-sm transition-all hover:bg-violet-50 dark:hover:bg-violet-900/50 hover:-translate-y-0.5"
                      >
                        <Bot className="size-4" />
                        {t('generation.viewAgents')}
                      </button>
                    )}
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </motion.div>

        {/* Right Canvas: Detailed Content Visualizer */}
        <motion.div
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          className="flex-1 h-full bg-white/40 dark:bg-slate-900/40 backdrop-blur-xl rounded-3xl border border-violet-200/30 dark:border-violet-800/30 shadow-xl overflow-hidden relative flex flex-col"
        >
          <AnimatePresence mode="wait">
            {error || insufficientCredits ? (
              <motion.div
                key="error"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="absolute inset-0 flex flex-col items-center justify-center p-12 text-center"
              >
                <div className="size-32 rounded-full bg-red-500/10 flex items-center justify-center border-2 border-red-500/20 shadow-[0_0_40px_rgba(239,68,68,0.2)] mb-6">
                  <AlertCircle className="size-16 text-red-500" />
                </div>
                <h3 className="text-2xl font-bold text-red-600 dark:text-red-400 mb-2">{t('generation.processHalted')}</h3>
                <p className="text-muted-foreground max-w-md">{t('generation.processHaltedDesc')}</p>
              </motion.div>
            ) : isComplete ? (
              <motion.div
                key="complete"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="absolute inset-0 flex flex-col items-center justify-center p-12 text-center"
              >
                <div className="size-32 rounded-full bg-green-500/10 flex items-center justify-center border-2 border-green-500/20 shadow-[0_0_40px_rgba(34,197,94,0.2)] mb-6">
                  <CheckCircle2 className="size-16 text-green-500" />
                </div>
                <h3 className="text-2xl font-bold text-green-600 dark:text-green-400 mb-2">{t('generation.readyToLaunch')}</h3>
                <p className="text-muted-foreground max-w-md">{t('generation.readyToLaunchDesc')}</p>
              </motion.div>
            ) : (
              <motion.div
                key={activeStep.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5 }}
                className="absolute inset-0 flex items-center justify-center p-8 overflow-y-auto custom-scrollbar"
              >
                <StepVisualizer
                  stepId={activeStep.id}
                  outlines={streamingOutlines}
                  webSearchSources={webSearchSources}
                  outlineSlot={
                    activeStep.id === 'outline' && outlineReview.status !== 'idle' ? (
                      <OutlineEditor
                        outlines={outlineReview.editing}
                        onChange={handleOutlineEditChange}
                        onConfirm={handleConfirmOutlines}
                        onRegenerateAll={handleRegenerateAll}
                        onRegenerateOne={handleRegenerateOne}
                        busy={
                          outlineReview.status === 'regenerating-all'
                            ? 'all'
                            : outlineReview.status === 'regenerating-one'
                              ? 'one'
                              : 'none'
                        }
                        regeneratingId={outlineReview.regeneratingId}
                        errorMessage={outlineReview.error}
                      />
                    ) : undefined
                  }
                />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

      </div>

      {/* Agent Reveal Modal */}
      <AgentRevealModal
        agents={generatedAgents}
        open={showAgentReveal}
        onClose={() => setShowAgentReveal(false)}
        onAllRevealed={() => {
          agentRevealResolveRef.current?.();
          agentRevealResolveRef.current = null;
        }}
      />
    </div>
  );
}

export default function GenerationPreviewPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[100dvh] w-full bg-gradient-to-br from-slate-50 via-violet-50/40 to-slate-100 dark:from-slate-950 dark:via-violet-950/20 dark:to-slate-900 flex items-center justify-center">
          <div className="animate-pulse space-y-6 text-center">
            <div className="h-10 w-10 bg-violet-200 dark:bg-violet-800/50 rounded-full mx-auto" />
            <div className="h-6 w-56 bg-violet-100 dark:bg-violet-900/30 rounded-full mx-auto" />
            <div className="h-4 w-40 bg-slate-100 dark:bg-slate-800 rounded-full mx-auto" />
          </div>
        </div>
      }
    >
      <GenerationPreviewContent />
    </Suspense>
  );
}
