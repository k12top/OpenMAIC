'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw, X } from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useStageStore } from '@/lib/store';
import { useSettingsStore } from '@/lib/store/settings';
import type { SceneOutline } from '@/lib/types/generation';
import type { MediaGenerationRequest } from '@/lib/media/types';
import type { ProviderId } from '@/lib/ai/providers';
import {
  isReconstructedOutlineId,
  reconstructOutlineFromScene,
} from '@/lib/utils/outline-reconstruct';
import { cn } from '@/lib/utils';

type Mode = 'retry' | 'simple' | 'advanced';

export type RegenerateSceneOverrides = Partial<
  Pick<SceneOutline, 'title' | 'description' | 'keyPoints' | 'mediaGenerations'>
>;

export interface RegenerateModelOverride {
  providerId: ProviderId;
  modelId: string;
}

interface RegenerateSceneDialogProps {
  sceneId: string | null;
  onClose: () => void;
  onSubmit: (
    sceneId: string,
    overrides: RegenerateSceneOverrides,
    modelOverride: RegenerateModelOverride,
  ) => Promise<void> | void;
}

/**
 * Owner-only dialog to kick off regenerating a single page. Offers two modes:
 * - simple: edit description only (what most users need).
 * - advanced: edit title, description, key-points, and media-generation prompts.
 */
export function RegenerateSceneDialog({
  sceneId,
  onClose,
  onSubmit,
}: RegenerateSceneDialogProps) {
  const { t } = useI18n();
  const scenes = useStageStore.use.scenes();
  const outlines = useStageStore.use.outlines();

  // Outlines are persisted to IndexedDB only — when a user opens the
  // classroom on a fresh browser / cleared profile, the lookup by `order`
  // can come back empty even though the scene exists. Fall back to a
  // best-effort outline reconstructed from the scene itself so the dialog
  // (and the regenerate pipeline) keep working. We surface a banner to
  // the user so they understand retry-mode will work off a barebones
  // outline and that simple/advanced modes let them fill in the gaps.
  const { scene, outline, outlineReconstructed } = useMemo(() => {
    const s = sceneId ? scenes.find((x) => x.id === sceneId) : null;
    if (!s) return { scene: null, outline: null, outlineReconstructed: false };
    const persisted = outlines.find((x) => x.order === s.order);
    if (persisted) {
      return {
        scene: s,
        outline: persisted,
        outlineReconstructed: isReconstructedOutlineId(persisted.id),
      };
    }
    return {
      scene: s,
      outline: reconstructOutlineFromScene(s),
      outlineReconstructed: true,
    };
  }, [sceneId, scenes, outlines]);

  // Current global LLM selection — used as the default for the override dropdown.
  const globalProviderId = useSettingsStore((s) => s.providerId);
  const globalModelId = useSettingsStore((s) => s.modelId);
  const providersConfig = useSettingsStore((s) => s.providersConfig);

  // Build the list of selectable (provider, model) pairs — same predicate as
  // the Settings ModelSelector: usable providers only.
  const modelOptions = useMemo(() => {
    type Group = {
      providerId: ProviderId;
      providerName: string;
      models: { id: string; name: string }[];
    };
    const groups: Group[] = [];
    for (const [pid, config] of Object.entries(providersConfig)) {
      if (!config) continue;
      const usable =
        (!config.requiresApiKey || config.apiKey || config.isServerConfigured) &&
        config.models.length >= 1 &&
        (config.baseUrl || config.defaultBaseUrl || config.serverBaseUrl);
      if (!usable) continue;
      // Restrict to server-allowed models when using a server-configured
      // provider without own key.
      let models = config.models;
      if (config.isServerConfigured && !config.apiKey && config.serverModels?.length) {
        const allowed = new Set(config.serverModels);
        models = models.filter((m) => allowed.has(m.id));
      }
      if (!models.length) continue;
      groups.push({
        providerId: pid as ProviderId,
        providerName: config.name || pid,
        models: models.map((m) => ({ id: m.id, name: m.name || m.id })),
      });
    }
    return groups;
  }, [providersConfig]);

  const [mode, setMode] = useState<Mode>('retry');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [keyPointsText, setKeyPointsText] = useState('');
  const [mediaPrompts, setMediaPrompts] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  // `${providerId}:::${modelId}` — keeps provider+model paired in a single <select>.
  const [modelKey, setModelKey] = useState<string>(
    `${globalProviderId}:::${globalModelId || ''}`,
  );

  // Reseed modelKey when the global selection changes (e.g. user switched
  // provider in settings while the dialog was closed).
  useEffect(() => {
    setModelKey(`${globalProviderId}:::${globalModelId || ''}`);
  }, [globalProviderId, globalModelId]);

  // Seed form state whenever the target scene changes.
  useEffect(() => {
    if (!outline) return;
    setTitle(outline.title || '');
    setDescription(outline.description || '');
    setKeyPointsText((outline.keyPoints || []).join('\n'));
    const seeded: Record<string, string> = {};
    for (const m of outline.mediaGenerations || []) {
      seeded[m.elementId] = m.prompt;
    }
    setMediaPrompts(seeded);
    setMode('retry');
  }, [outline?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = !!sceneId;
  if (!open) return null;

  if (!scene || !outline) {
    // Target scene was deleted between opening the dialog and now — dismiss.
    return null;
  }
  // After this point `outline` is always defined (either persisted or
  // freshly reconstructed via reconstructOutlineFromScene above).

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const [pid, mid] = modelKey.split(':::');
      const modelOverride: RegenerateModelOverride = {
        providerId: (pid || globalProviderId) as ProviderId,
        modelId: mid || globalModelId || '',
      };
      const overrides: RegenerateSceneOverrides = {};
      if (mode === 'retry') {
        // No overrides — just re-run the same outline.
      } else if (mode === 'simple') {
        const trimmed = description.trim();
        if (trimmed && trimmed !== outline.description) overrides.description = trimmed;
      } else {
        const trimmedTitle = title.trim();
        if (trimmedTitle && trimmedTitle !== outline.title) overrides.title = trimmedTitle;

        const trimmedDesc = description.trim();
        if (trimmedDesc !== outline.description) overrides.description = trimmedDesc;

        const points = keyPointsText
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean);
        const currentPoints = outline.keyPoints || [];
        const pointsChanged =
          points.length !== currentPoints.length ||
          points.some((p, i) => p !== currentPoints[i]);
        if (pointsChanged) overrides.keyPoints = points;

        if (outline.mediaGenerations && outline.mediaGenerations.length > 0) {
          const nextMedia: MediaGenerationRequest[] = outline.mediaGenerations.map((m) => ({
            ...m,
            prompt: (mediaPrompts[m.elementId] ?? m.prompt).trim() || m.prompt,
          }));
          const changed = nextMedia.some(
            (m, i) => m.prompt !== outline.mediaGenerations![i].prompt,
          );
          if (changed) overrides.mediaGenerations = nextMedia;
        }
      }

      await onSubmit(scene.id, overrides, modelOverride);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl mx-4 rounded-2xl bg-white dark:bg-slate-900 shadow-xl border border-border/40 flex flex-col max-h-[min(85vh,720px)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-border/30">
          <div className="flex items-center gap-3 min-w-0">
            <div className="size-9 shrink-0 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
              <RefreshCw className="size-4 text-purple-600 dark:text-purple-400" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-foreground truncate">
                {t('stage.regenerateScene')}
              </h2>
              <p className="text-xs text-muted-foreground truncate">
                {scene.title || outline.title}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="size-8 shrink-0 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Model override */}
        <div className="px-6 pt-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-foreground">
              {t('stage.regenerateModelLabel')}
            </span>
            <select
              value={modelKey}
              onChange={(e) => setModelKey(e.target.value)}
              disabled={submitting || modelOptions.length === 0}
              className="w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400/40 disabled:opacity-60"
            >
              {modelOptions.length === 0 ? (
                <option value={modelKey}>{globalModelId || globalProviderId}</option>
              ) : (
                modelOptions.map((g) => (
                  <optgroup key={g.providerId} label={g.providerName}>
                    {g.models.map((m) => (
                      <option key={`${g.providerId}:::${m.id}`} value={`${g.providerId}:::${m.id}`}>
                        {m.name}
                      </option>
                    ))}
                  </optgroup>
                ))
              )}
            </select>
          </label>
        </div>

        {/* Mode tabs */}
        <div className="px-6 pt-4">
          <div className="inline-flex rounded-lg bg-muted/50 p-1 text-xs font-medium">
            {(['retry', 'simple', 'advanced'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cn(
                  'px-3 py-1.5 rounded-md transition-colors',
                  mode === m
                    ? 'bg-white dark:bg-slate-800 text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {m === 'retry'
                  ? t('stage.retryMode')
                  : m === 'simple'
                    ? t('stage.simpleMode')
                    : t('stage.advancedMode')}
              </button>
            ))}
          </div>
        </div>

        {/* Form */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {outlineReconstructed && (
            <div className="rounded-lg border border-amber-300/60 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-950/30 p-3 text-xs text-amber-800 dark:text-amber-200 leading-relaxed flex gap-2 items-start">
              <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
              <span>{t('stage.outlineMissingHint')}</span>
            </div>
          )}
          {mode === 'retry' ? (
            <div className="rounded-lg bg-muted/30 border border-border/40 p-4 text-xs text-muted-foreground leading-relaxed">
              {t('stage.retryModeHint')}
            </div>
          ) : mode === 'simple' ? (
            <Field label={t('stage.descriptionLabel')}>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={6}
                className="w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-purple-400/40"
                placeholder={t('stage.descriptionPlaceholder')}
              />
            </Field>
          ) : (
            <>
              <Field label={t('stage.titleLabel')}>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400/40"
                />
              </Field>
              <Field label={t('stage.descriptionLabel')}>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  className="w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-purple-400/40"
                />
              </Field>
              <Field
                label={t('stage.keyPointsLabel')}
                hint={t('stage.keyPointsHint')}
              >
                <textarea
                  value={keyPointsText}
                  onChange={(e) => setKeyPointsText(e.target.value)}
                  rows={4}
                  className="w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-purple-400/40"
                  placeholder={t('stage.keyPointsPlaceholder')}
                />
              </Field>
              {outline.mediaGenerations && outline.mediaGenerations.length > 0 && (
                <Field
                  label={t('stage.mediaPromptsLabel')}
                  hint={t('stage.mediaPromptsHint')}
                >
                  <div className="space-y-2">
                    {outline.mediaGenerations.map((m) => (
                      <div
                        key={m.elementId}
                        className="rounded-lg border border-border/40 bg-muted/20 p-2 space-y-1"
                      >
                        <div className="flex items-center gap-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                          <span className="rounded bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-300 px-1.5 py-0.5">
                            {m.type}
                          </span>
                          <span className="truncate">{m.elementId}</span>
                        </div>
                        <textarea
                          value={mediaPrompts[m.elementId] ?? ''}
                          onChange={(e) =>
                            setMediaPrompts((prev) => ({
                              ...prev,
                              [m.elementId]: e.target.value,
                            }))
                          }
                          rows={2}
                          className="w-full rounded-md border border-border/40 bg-background px-2 py-1.5 text-xs resize-y focus:outline-none focus:ring-2 focus:ring-purple-400/40"
                        />
                      </div>
                    ))}
                  </div>
                </Field>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border/30">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted/50 transition-colors disabled:opacity-50"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-purple-600 text-white hover:bg-purple-700 transition-colors disabled:opacity-50 inline-flex items-center gap-2"
          >
            {submitting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            {t('stage.startRegenerate')}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <label className="text-xs font-semibold text-foreground">{label}</label>
        {hint && <span className="text-[10px] text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
