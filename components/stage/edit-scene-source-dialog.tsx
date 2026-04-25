'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Save, X } from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useStageStore } from '@/lib/store';
import type { Scene } from '@/lib/types/stage';
import { flushClassroomSync } from '@/lib/sync/classroom-sync';
import { ThumbnailSlide } from '@/components/slide-renderer/components/ThumbnailSlide';
import { cn } from '@/lib/utils';

interface EditSceneSourceDialogProps {
  /** The scene currently being edited; null/absent = dialog closed. */
  sceneId: string | null;
  onClose: () => void;
}

/**
 * Owner-only dialog that lets the classroom author edit a scene's raw JSON.
 *
 * Behavior:
 * - On open: take an immutable snapshot for safety and initialize local JSON.
 * - On each valid edit: only update local preview state (no stage mutation),
 *   so the underlying classroom canvas/layout remains untouched.
 * - On Save: `flushClassroomSync()` + `enableSync()` — changes persist to
 *   IndexedDB (via debounced save triggered by updateScene) and an
 *   immediate POST fires to `/api/classroom/sync`.
 * - On Cancel / Escape / backdrop click: just close (no rollback needed,
 *   because nothing in stage store was changed before Save).
 */
export function EditSceneSourceDialog({ sceneId, onClose }: EditSceneSourceDialogProps) {
  const { t } = useI18n();
  const scenes = useStageStore.use.scenes();
  const updateScene = useStageStore.use.updateScene();

  const currentScene = useMemo(
    () => (sceneId ? scenes.find((s) => s.id === sceneId) || null : null),
    [sceneId, scenes],
  );

  // We keep three refs/state to manage the edit lifecycle:
  // - `snapshotRef` captures the scene at open-time so we can rollback cleanly
  // - `text` is the user's in-progress JSON text (may be invalid)
  // - `parseError` surfaces JSON errors in the UI without blocking typing
  const snapshotRef = useRef<Scene | null>(null);
  const [text, setText] = useState<string>('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Open-time setup: snapshot + seed the textarea.
  // We intentionally depend only on `sceneId` (not on the scene object) so
  // later updates from our own preview mutations don't re-trigger this.
  useEffect(() => {
    if (!sceneId) return;
    const scene = useStageStore.getState().scenes.find((s) => s.id === sceneId);
    if (!scene) return;

    snapshotRef.current = structuredClone(scene);
    setText(JSON.stringify(scene, null, 2));
    setParseError(null);
    setSaving(false);

    // No cleanup here — rollback/commit paths below handle `enableSync()`.
  }, [sceneId]);

  // Escape key = cancel
  useEffect(() => {
    if (!sceneId) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleCancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneId]);

  const localPreviewScene = useMemo(() => {
    try {
      const parsed = JSON.parse(text) as Scene;
      if (parsed && typeof parsed === 'object' && parsed.id === sceneId) {
        return parsed;
      }
    } catch {
      // ignore
    }
    return currentScene as Scene;
  }, [text, sceneId, currentScene]);

  const handleTextChange = useCallback(
    (next: string) => {
      setText(next);
      if (!sceneId) return;
      try {
        const parsed = JSON.parse(next) as Scene;
        // Hard invariant: the id must match — rewriting ids would corrupt
        // scene references elsewhere (current scene, chat sessions, etc.).
        if (parsed && typeof parsed === 'object' && parsed.id === sceneId) {
          setParseError(null);
        } else {
          setParseError('Scene id mismatch — JSON root must keep the same `id` field.');
        }
      } catch (err) {
        setParseError((err as Error).message);
      }
    },
    [sceneId],
  );

  const handleCancel = useCallback(() => {
    snapshotRef.current = null;
    onClose();
  }, [onClose]);

  const handleSave = useCallback(async () => {
    if (!sceneId || parseError) return;
    setSaving(true);
    try {
      // Ensure the latest parsed value is committed (in case the user typed
      // but onChange fired with an invalid intermediate state, the state
      // might already be correct — parse once more defensively).
      try {
        const parsed = JSON.parse(text) as Scene;
        if (parsed && parsed.id === sceneId) {
          updateScene(sceneId, parsed);
        }
      } catch {
        setParseError(t('stage.editSourceInvalidJson') || 'Invalid JSON');
        setSaving(false);
        return;
      }
      // Trigger a fresh debounced sync then flush immediately so save feels instant.
      flushClassroomSync();
      snapshotRef.current = null;
      onClose();
    } finally {
      setSaving(false);
    }
  }, [sceneId, parseError, text, updateScene, onClose, t]);

  if (!sceneId || !currentScene) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={handleCancel}
    >
      <div
        className="w-full max-w-6xl h-[80vh] bg-white dark:bg-gray-900 rounded-xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {t('stage.editSourceTitle') || 'Edit Scene Source'}
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {t('stage.editSourceHint') ||
                'Edit the raw JSON of this scene. Changes stay local until you save.'}
            </p>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body: split pane */}
        <div className="flex-1 flex min-h-0">
          {/* Left: JSON editor */}
          <div className="w-1/2 flex flex-col border-r border-gray-100 dark:border-gray-800">
            <textarea
              value={text}
              onChange={(e) => handleTextChange(e.target.value)}
              spellCheck={false}
              className={cn(
                'flex-1 w-full p-3 font-mono text-xs leading-relaxed resize-none',
                'bg-gray-50 dark:bg-gray-950 text-gray-800 dark:text-gray-200',
                'outline-none border-0 focus:ring-0',
              )}
            />
            {parseError && (
              <div className="px-3 py-2 text-[11px] bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 border-t border-red-100 dark:border-red-900/40 shrink-0">
                <span className="font-semibold">
                  {t('stage.editSourceInvalidJson') || 'Invalid JSON'}:
                </span>{' '}
                {parseError}
              </div>
            )}
          </div>

          {/* Right: isolated preview (does not mutate current classroom view) */}
          <div className="w-1/2 flex flex-col bg-gray-100 dark:bg-gray-950 min-w-0">
            <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-800 bg-white/60 dark:bg-gray-900/60">
              {t('stage.preview') || 'Preview'}
            </div>
            <div className="flex-1 overflow-auto p-2 min-h-0">
              <div className="w-full h-full bg-white dark:bg-gray-900 rounded-md shadow-inner overflow-hidden">
                <SourcePreview scene={localPreviewScene} />
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-100 dark:border-gray-800 shrink-0">
          <button
            type="button"
            onClick={handleCancel}
            className="px-3 py-1.5 text-sm rounded-md text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            {t('stage.cancel') || 'Cancel'}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!!parseError || saving}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md',
              'bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {saving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            {t('stage.save') || 'Save'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function SourcePreview({ scene }: { scene: Scene }) {
  if (scene.type === 'slide' && scene.content?.type === 'slide') {
    const canvas = scene.content.canvas;
    return (
      <div className="w-full h-full p-3 flex items-center justify-center bg-slate-100 dark:bg-slate-950">
        <div className="w-full max-w-[760px]">
          <ThumbnailSlide
            slide={canvas}
            viewportSize={canvas.viewportSize ?? 1000}
            viewportRatio={canvas.viewportRatio ?? 0.5625}
            size={760}
          />
        </div>
      </div>
    );
  }

  // Fallback preview for non-slide scenes: keep it safe and context-free.
  return (
    <div className="w-full h-full overflow-auto p-3">
      <div className="mb-2 text-xs font-semibold text-gray-600 dark:text-gray-300">
        Scene Type: {scene.type}
      </div>
      <pre className="text-[11px] leading-relaxed p-3 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 overflow-auto">
        {JSON.stringify(scene.content, null, 2)}
      </pre>
    </div>
  );
}
