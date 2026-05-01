'use client';

import { useState, useCallback, useMemo } from 'react';
import {
  X,
  BookOpen,
  PieChart,
  MousePointer2,
  Plus,
  Loader2,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useStageStore } from '@/lib/store/stage';
import { useSettingsStore } from '@/lib/store/settings';
import { useI18n } from '@/lib/hooks/use-i18n';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { generateId, createDefaultContent } from '@/lib/api/stage-api-defaults';
import type { Scene, SceneOutline } from '@/lib/types/stage';
import type { Action, SpeechAction } from '@/lib/types/action';
import { generateAndStoreTTS } from '@/lib/hooks/use-scene-generator';
import { splitLongSpeechActions } from '@/lib/audio/tts-utils';
import { getCurrentModelConfig } from '@/lib/utils/model-config';

interface AddSceneDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Insert position: append after this scene's order. If undefined, append at end. */
  insertAfterOrder?: number;
}

type AddSceneType = 'slide' | 'quiz' | 'interactive';

interface SceneTypeMeta {
  type: AddSceneType;
  labelKey: string;
  descKey: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
}

const SCENE_TYPES: SceneTypeMeta[] = [
  {
    type: 'slide',
    labelKey: 'addScene.typeSlide',
    descKey: 'addScene.typeSlideDesc',
    icon: BookOpen,
    accent:
      'bg-purple-50 dark:bg-purple-950/30 border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300',
  },
  {
    type: 'quiz',
    labelKey: 'addScene.typeQuiz',
    descKey: 'addScene.typeQuizDesc',
    icon: PieChart,
    accent:
      'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300',
  },
  {
    type: 'interactive',
    labelKey: 'addScene.typeInteractive',
    descKey: 'addScene.typeInteractiveDesc',
    icon: MousePointer2,
    accent:
      'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300',
  },
];

export function AddSceneDialog({ open, onOpenChange, insertAfterOrder }: AddSceneDialogProps) {
  const { t } = useI18n();

  const [type, setType] = useState<AddSceneType>('slide');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [keyPoints, setKeyPoints] = useState<string[]>(['']);
  const [questionCount, setQuestionCount] = useState(3);
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [interactivePrompt, setInteractivePrompt] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reset = useCallback(() => {
    setType('slide');
    setTitle('');
    setDescription('');
    setKeyPoints(['']);
    setQuestionCount(3);
    setDifficulty('medium');
    setInteractivePrompt('');
  }, []);

  const handleClose = useCallback(() => {
    if (submitting) return;
    onOpenChange(false);
    reset();
  }, [submitting, onOpenChange, reset]);

  const filteredKeyPoints = useMemo(
    () => keyPoints.map((kp) => kp.trim()).filter(Boolean),
    [keyPoints],
  );

  const canSubmit = title.trim().length > 0 && !submitting;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    const stage = useStageStore.getState().stage;
    const scenes = useStageStore.getState().scenes;
    if (!stage) {
      toast.error(t('addScene.failed'));
      return;
    }

    setSubmitting(true);
    const placeholderId = generateId('scene');
    const baseOrder =
      insertAfterOrder !== undefined
        ? insertAfterOrder + 0.5
        : scenes.length > 0
          ? scenes[scenes.length - 1].order + 1
          : 1;

    // 1) Insert placeholder so the user immediately sees a "generating" card
    //    in the sidebar. We wrap the AI work in try/finally to clean up.
    const placeholderScene: Scene = {
      id: placeholderId,
      stageId: stage.id,
      type,
      title: title.trim(),
      order: baseOrder,
      content: createDefaultContent(type),
      actions: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    useStageStore.getState().addScene(placeholderScene);
    // Normalize order across all scenes so the new one slots in cleanly
    const orderedIds = useStageStore
      .getState()
      .scenes.slice()
      .sort((a, b) => a.order - b.order)
      .map((s) => s.id);
    useStageStore.getState().reorderScenes(orderedIds);
    useStageStore.getState().setCurrentSceneId(placeholderId);

    // Build outline from form input
    const outline: SceneOutline = {
      id: generateId('outline'),
      type,
      title: title.trim(),
      description: description.trim() || title.trim(),
      keyPoints: filteredKeyPoints.length > 0 ? filteredKeyPoints : [title.trim()],
      order: baseOrder,
      language: stage.language as SceneOutline['language'],
      ...(type === 'quiz'
        ? {
            quizConfig: {
              questionCount,
              difficulty,
              questionTypes: ['single'] as ('single' | 'multiple' | 'text')[],
            },
          }
        : {}),
      ...(type === 'interactive' && interactivePrompt.trim()
        ? {
            interactiveConfig: {
              conceptName: title.trim(),
              conceptOverview: description.trim() || title.trim(),
              designIdea: interactivePrompt.trim(),
            },
          }
        : {}),
    };

    const stageInfo = {
      name: stage.name,
      description: stage.description,
      language: stage.language,
      style: stage.style,
    };

    const agents = (stage.generatedAgentConfigs || []).map((a) => ({
      id: a.id,
      name: a.name,
      role: a.role,
      persona: a.persona,
    }));

    const headers = buildLLMHeaders();

    try {
      // Hide dialog while the heavy work runs in the background — feels
      // snappier to the teacher and the placeholder shows progress.
      onOpenChange(false);

      // 2) Generate scene content (slide elements / quiz questions / etc.)
      const contentRes = await fetch('/api/generate/scene-content', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          outline,
          allOutlines: [outline],
          stageId: stage.id,
          stageInfo,
          agents,
        }),
      });
      if (!contentRes.ok) {
        const err = await contentRes.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${contentRes.status}`);
      }
      const contentData = await contentRes.json();
      const generatedContent = contentData.content;
      const effectiveOutline = contentData.effectiveOutline || outline;

      // 3) Generate actions (speech narration etc.)
      const actionsRes = await fetch('/api/generate/scene-actions', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          outline: effectiveOutline,
          allOutlines: [effectiveOutline],
          content: generatedContent,
          stageId: stage.id,
          agents,
          previousSpeeches: collectPreviousSpeeches(scenes, baseOrder),
        }),
      });
      if (!actionsRes.ok) {
        const err = await actionsRes.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${actionsRes.status}`);
      }
      const actionsData = await actionsRes.json();
      const generatedScene: Scene | undefined = actionsData.scene;
      if (!generatedScene) throw new Error('Empty actions response');

      // 4) Replace placeholder content/actions while keeping placeholder id
      //    (so currentSceneId remains valid and scrolling stays put).
      useStageStore.getState().updateScene(placeholderId, {
        content: generatedScene.content,
        actions: generatedScene.actions,
        whiteboards: generatedScene.whiteboards,
        multiAgent: generatedScene.multiAgent,
        title: generatedScene.title || title.trim(),
        updatedAt: Date.now(),
      });

      // 5) Generate TTS for speech actions on the new scene (best-effort).
      const settings = useSettingsStore.getState();
      if (
        settings.ttsEnabled &&
        settings.ttsProviderId !== 'browser-native-tts' &&
        generatedScene.actions
      ) {
        const provId = settings.ttsProviderId;
        const splitted = splitLongSpeechActions(generatedScene.actions || [], provId);
        const speeches = splitted.filter(
          (a): a is SpeechAction => a.type === 'speech' && !!a.text,
        );
        for (const sp of speeches) {
          if (!sp.audioId) sp.audioId = `tts_${sp.id}`;
        }
        // Persist split actions before TTS (so audioIds are stored)
        useStageStore
          .getState()
          .updateScene(placeholderId, { actions: splitted as Action[] });

        await Promise.allSettled(
          speeches.map((sp) =>
            generateAndStoreTTS(sp.audioId!, sp.text).catch(() => undefined),
          ),
        );
      }

      toast.success(t('addScene.success'));
    } catch (err) {
      // Keep the placeholder so the user can manually delete it from the
      // sidebar; surface the error.
      toast.error(
        err instanceof Error ? `${t('addScene.failed')}: ${err.message}` : t('addScene.failed'),
      );
    } finally {
      setSubmitting(false);
      reset();
    }
  }, [
    canSubmit,
    type,
    title,
    description,
    filteredKeyPoints,
    questionCount,
    difficulty,
    interactivePrompt,
    insertAfterOrder,
    onOpenChange,
    reset,
    t,
  ]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-lg mx-4 rounded-2xl bg-white dark:bg-slate-900 shadow-xl border border-border/40 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-4 flex items-center justify-between border-b border-border/30 shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-purple-500" />
            <h2 className="text-sm font-semibold text-foreground">{t('addScene.title')}</h2>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Type selector */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-2">
              {t('addScene.typeLabel')}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {SCENE_TYPES.map((meta) => {
                const Icon = meta.icon;
                const active = type === meta.type;
                return (
                  <button
                    key={meta.type}
                    onClick={() => setType(meta.type)}
                    disabled={submitting}
                    className={cn(
                      'flex flex-col gap-1.5 items-start text-left rounded-xl border px-3 py-2.5 transition-all disabled:opacity-50',
                      active
                        ? meta.accent
                        : 'border-border/40 text-muted-foreground hover:bg-muted/30',
                    )}
                  >
                    <Icon className="size-4" />
                    <span className="text-xs font-semibold">{t(meta.labelKey)}</span>
                    <span className="text-[10px] leading-tight opacity-80">{t(meta.descKey)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              {t('addScene.titleField')}
              <span className="text-red-500 ml-1">*</span>
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={submitting}
              placeholder={t('addScene.titlePlaceholder')}
              className="w-full px-3 py-2 rounded-lg border border-border/40 bg-background text-sm focus:outline-none focus:ring-1 focus:ring-purple-400 disabled:opacity-50"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              {t('addScene.descriptionField')}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={submitting}
              placeholder={t('addScene.descriptionPlaceholder')}
              rows={2}
              className="w-full px-3 py-2 rounded-lg border border-border/40 bg-background text-sm focus:outline-none focus:ring-1 focus:ring-purple-400 disabled:opacity-50 resize-none"
            />
          </div>

          {/* Key points */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              {t('addScene.keyPointsField')}
            </label>
            <div className="space-y-1.5">
              {keyPoints.map((kp, i) => (
                <div key={i} className="flex gap-1.5 items-center">
                  <input
                    value={kp}
                    onChange={(e) => {
                      const next = keyPoints.slice();
                      next[i] = e.target.value;
                      setKeyPoints(next);
                    }}
                    disabled={submitting}
                    placeholder={t('addScene.keyPointPlaceholder')}
                    className="flex-1 px-3 py-1.5 rounded-lg border border-border/40 bg-background text-xs focus:outline-none focus:ring-1 focus:ring-purple-400 disabled:opacity-50"
                  />
                  {keyPoints.length > 1 && (
                    <button
                      onClick={() => setKeyPoints(keyPoints.filter((_, idx) => idx !== i))}
                      disabled={submitting}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors disabled:opacity-50"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </div>
              ))}
              {keyPoints.length < 6 && (
                <button
                  onClick={() => setKeyPoints([...keyPoints, ''])}
                  disabled={submitting}
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-50"
                >
                  <Plus className="size-3" /> {t('addScene.addKeyPoint')}
                </button>
              )}
            </div>
          </div>

          {/* Quiz config */}
          {type === 'quiz' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                  {t('addScene.quizQuestionCount')}
                </label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={questionCount}
                  onChange={(e) => setQuestionCount(Math.max(1, Math.min(10, +e.target.value || 3)))}
                  disabled={submitting}
                  className="w-full px-3 py-2 rounded-lg border border-border/40 bg-background text-sm focus:outline-none focus:ring-1 focus:ring-purple-400 disabled:opacity-50"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                  {t('addScene.quizDifficulty')}
                </label>
                <select
                  value={difficulty}
                  onChange={(e) => setDifficulty(e.target.value as 'easy' | 'medium' | 'hard')}
                  disabled={submitting}
                  className="w-full px-3 py-2 rounded-lg border border-border/40 bg-background text-sm focus:outline-none focus:ring-1 focus:ring-purple-400 disabled:opacity-50"
                >
                  <option value="easy">{t('addScene.difficultyEasy')}</option>
                  <option value="medium">{t('addScene.difficultyMedium')}</option>
                  <option value="hard">{t('addScene.difficultyHard')}</option>
                </select>
              </div>
            </div>
          )}

          {/* Interactive config */}
          {type === 'interactive' && (
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                {t('addScene.interactiveDesignIdea')}
              </label>
              <textarea
                value={interactivePrompt}
                onChange={(e) => setInteractivePrompt(e.target.value)}
                disabled={submitting}
                placeholder={t('addScene.interactiveDesignIdeaPlaceholder')}
                rows={3}
                className="w-full px-3 py-2 rounded-lg border border-border/40 bg-background text-sm focus:outline-none focus:ring-1 focus:ring-purple-400 disabled:opacity-50 resize-none"
              />
            </div>
          )}

          <p className="text-[11px] text-muted-foreground/60 leading-relaxed">
            {t('addScene.aiHint')}
          </p>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 flex items-center justify-end gap-2 border-t border-border/30 shrink-0">
          <button
            onClick={handleClose}
            disabled={submitting}
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:bg-muted/50 transition-colors disabled:opacity-50"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition-all disabled:opacity-50 flex items-center gap-1.5"
          >
            {submitting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
            {submitting ? t('addScene.generating') : t('addScene.generate')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── helpers ────────────────────────────────────────────────────────────

function buildLLMHeaders(): Record<string, string> {
  const config = getCurrentModelConfig();
  const settings = useSettingsStore.getState();
  const imageProviderConfig = settings.imageProvidersConfig?.[settings.imageProviderId];
  const videoProviderConfig = settings.videoProvidersConfig?.[settings.videoProviderId];
  return {
    'Content-Type': 'application/json',
    'x-model': config.modelString || '',
    'x-api-key': config.apiKey || '',
    'x-base-url': config.baseUrl || '',
    'x-provider-type': config.providerType || '',
    'x-image-provider': settings.imageProviderId || '',
    'x-image-model': settings.imageModelId || '',
    'x-image-api-key': imageProviderConfig?.apiKey || '',
    'x-image-base-url': imageProviderConfig?.baseUrl || '',
    'x-video-provider': settings.videoProviderId || '',
    'x-video-model': settings.videoModelId || '',
    'x-video-api-key': videoProviderConfig?.apiKey || '',
    'x-video-base-url': videoProviderConfig?.baseUrl || '',
    'x-image-generation-enabled': String(settings.imageGenerationEnabled ?? false),
    'x-video-generation-enabled': String(settings.videoGenerationEnabled ?? false),
  };
}

function collectPreviousSpeeches(scenes: Scene[], beforeOrder: number): string[] {
  const sorted = scenes
    .filter((s) => s.order < beforeOrder)
    .sort((a, b) => a.order - b.order);
  const prev = sorted[sorted.length - 1];
  if (!prev?.actions) return [];
  return (prev.actions || [])
    .filter((a): a is SpeechAction => a.type === 'speech')
    .map((a) => a.text);
}
