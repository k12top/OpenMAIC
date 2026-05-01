'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Loader2,
  Save,
  X,
  Code2,
  Columns,
  MonitorPlay,
  Mic,
  RefreshCw,
  Play,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useStageStore } from '@/lib/store';
import type { Scene } from '@/lib/types/stage';
import type { SpeechAction } from '@/lib/types/action';
import { flushClassroomSync } from '@/lib/sync/classroom-sync';
import { SceneProvider } from '@/lib/contexts/scene-context';
import { SceneRenderer } from './scene-renderer';
import { cn } from '@/lib/utils';
import { isSpeechAudioStale } from '@/lib/audio/tts-utils';
import { regenerateSingleSpeechAudio } from '@/lib/audio/regenerate-single-speech';
import { AudioPlayer } from '@/lib/utils/audio-player';

interface EditSceneSourceDialogProps {
  /** The scene currently being edited; null/absent = dialog closed. */
  sceneId: string | null;
  onClose: () => void;
  /** Optional: open a specific tab on mount. */
  initialTab?: 'split' | 'code' | 'preview' | 'speech';
  /** Optional: when on the speech tab, scroll to and highlight this audioId. */
  focusAudioId?: string | null;
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
export function EditSceneSourceDialog({
  sceneId,
  onClose,
  initialTab,
  focusAudioId,
}: EditSceneSourceDialogProps) {
  const { t } = useI18n();
  const scenes = useStageStore.use.scenes();
  const updateScene = useStageStore.use.updateScene();
  const updateSpeechActionText = useStageStore.use.updateSpeechActionText();

  const currentScene = useMemo(
    () => (sceneId ? scenes.find((s) => s.id === sceneId) || null : null),
    [sceneId, scenes],
  );

  // We keep three refs/state to manage the edit lifecycle:
  // - `snapshotRef` captures the scene at open-time so we can rollback cleanly
  // - `text` is the user's in-progress JSON text (may be invalid)
  // - `parseError` surfaces JSON errors in the UI without blocking typing
  const snapshotRef = useRef<Scene | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState<string>('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [viewMode, setViewMode] = useState<'split' | 'code' | 'preview' | 'speech'>(
    initialTab || 'split',
  );

  // Honor focusAudioId / initialTab when reopening for a different scene.
  useEffect(() => {
    if (initialTab) setViewMode(initialTab);
  }, [sceneId, initialTab]);

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
      // Speech tab edits are committed live via `updateSpeechActionText`,
      // so re-applying the (stale) JSON `text` snapshot would clobber them.
      // In speech mode just flush + close.
      if (viewMode === 'speech') {
        flushClassroomSync();
        snapshotRef.current = null;
        onClose();
        return;
      }
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
  }, [sceneId, parseError, text, updateScene, onClose, t, viewMode]);

  // Click-to-locate: find ID from clicked preview element and highlight in JSON
  const handlePreviewClick = useCallback(
    (e: React.MouseEvent) => {
      let current = e.target as HTMLElement | null;
      let foundId: string | null = null;

      while (current && current !== e.currentTarget) {
        // Many openmaic elements store ID in DOM id or data-id or class
        // E.g. <div id="editable-element-1234">
        const idAttr = current.getAttribute('id');
        if (idAttr) {
          // Extract possible UUID from id string
          const match = idAttr.match(
            /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i,
          );
          const rawId = match ? match[0] : idAttr;
          if (text.includes(`"${rawId}"`)) {
            foundId = rawId;
            break;
          }
        }

        if (current.dataset) {
          for (const key in current.dataset) {
            const val = current.dataset[key];
            if (val && text.includes(`"${val}"`)) {
              foundId = val;
              break;
            }
          }
        }
        current = current.parentElement;
      }

      if (foundId && textareaRef.current) {
        const searchStr = `"${foundId}"`;
        const index = text.indexOf(searchStr);
        if (index !== -1) {
          const textarea = textareaRef.current;
          textarea.focus();
          textarea.setSelectionRange(index, index + searchStr.length);

          const lines = text.substring(0, index).split('\n');
          textarea.scrollTop = Math.max(0, (lines.length - 5) * 18);
        }
      }
    },
    [text],
  );

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

        {/* Body: split pane (or speech editor when in speech mode) */}
        <div className="flex-1 flex min-h-0">
          {viewMode === 'speech' ? (
            <SpeechEditorPane
              scene={localPreviewScene}
              onTextChange={(audioId, newText) => updateSpeechActionText(audioId, newText)}
              focusAudioId={focusAudioId}
              t={t}
            />
          ) : null}
          {/* Left: JSON editor */}
          {viewMode !== 'preview' && viewMode !== 'speech' && (
            <div
              className={cn(
                'flex flex-col border-r border-gray-100 dark:border-gray-800 transition-all duration-300',
                viewMode === 'split' ? 'w-1/2' : 'w-full border-r-0',
              )}
            >
              <textarea
              ref={textareaRef}
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
          )}

          {/* Right: isolated preview (does not mutate current classroom view) */}
          {viewMode !== 'code' && viewMode !== 'speech' && (
            <div
              className={cn(
                'flex flex-col bg-gray-100 dark:bg-gray-950 min-w-0 transition-all duration-300',
                viewMode === 'split' ? 'w-1/2' : 'w-full'
              )}
            >
              <div className="px-3 py-1.5 flex items-center justify-between border-b border-gray-200 dark:border-gray-800 bg-white/60 dark:bg-gray-900/60">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  {t('stage.preview') || 'Preview'}
                </span>
                <span className="text-[10px] text-gray-400">Click elements to locate code</span>
              </div>
              <div
                className="flex-1 overflow-auto p-2 min-h-0 cursor-crosshair"
                onClickCapture={handlePreviewClick}
              >
                <div className="w-full h-full bg-white dark:bg-gray-900 rounded-md shadow-inner overflow-hidden pointer-events-none relative">
                  <div className="absolute inset-0 pointer-events-auto">
                    <SceneProvider scene={localPreviewScene}>
                      <SceneRenderer scene={localPreviewScene} mode="playback" isPreview={true} />
                    </SceneProvider>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-gray-100 dark:border-gray-800 shrink-0">
          <div>
            <div className="flex bg-gray-100/80 dark:bg-gray-800 p-1 rounded-lg border border-gray-200/60 dark:border-gray-700/60 shadow-inner">
              <button
                type="button"
                onClick={() => setViewMode('code')}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-all',
                  viewMode === 'code'
                    ? 'bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-gray-100'
                    : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-200/50 dark:hover:bg-gray-700/50'
                )}
              >
                <Code2 className="w-3.5 h-3.5" />
                {t('editSource.code')}
              </button>
              <button
                type="button"
                onClick={() => setViewMode('split')}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-all',
                  viewMode === 'split'
                    ? 'bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-gray-100'
                    : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-200/50 dark:hover:bg-gray-700/50'
                )}
              >
                <Columns className="w-3.5 h-3.5" />
                {t('editSource.split')}
              </button>
              <button
                type="button"
                onClick={() => setViewMode('preview')}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-all',
                  viewMode === 'preview'
                    ? 'bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-gray-100'
                    : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-200/50 dark:hover:bg-gray-700/50'
                )}
              >
                <MonitorPlay className="w-3.5 h-3.5" />
                {t('editSource.preview')}
              </button>
              <button
                type="button"
                onClick={() => setViewMode('speech')}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-all',
                  viewMode === 'speech'
                    ? 'bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-gray-100'
                    : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-200/50 dark:hover:bg-gray-700/50'
                )}
              >
                <Mic className="w-3.5 h-3.5" />
                {t('editSource.speech')}
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
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
      </div>
    </div>,
    document.body,
  );
}

// ────────────────────────────────────────────────────────────────────────
// Speech editor pane — list of speech actions with edit / regen / preview.
// Lives in this file because it is exclusively rendered by this dialog and
// shares the same scene-context wiring.
// ────────────────────────────────────────────────────────────────────────

interface SpeechEditorPaneProps {
  scene: Scene;
  onTextChange: (audioId: string, newText: string) => void;
  focusAudioId?: string | null;
  t: (key: string, options?: Record<string, unknown>) => string;
}

function SpeechEditorPane({ scene, onTextChange, focusAudioId, t }: SpeechEditorPaneProps) {
  const speechActions = useMemo(
    () =>
      (scene.actions || []).filter(
        (a): a is SpeechAction => a.type === 'speech' && !!a.audioId,
      ),
    [scene],
  );
  const containerRef = useRef<HTMLDivElement>(null);

  // Scroll the requested action into view on mount / focusAudioId change.
  useEffect(() => {
    if (!focusAudioId || !containerRef.current) return;
    const el = containerRef.current.querySelector(
      `[data-audio-id="${focusAudioId}"]`,
    ) as HTMLElement | null;
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focusAudioId]);

  if (speechActions.length === 0) {
    return (
      <div className="w-full flex items-center justify-center text-xs text-gray-500 dark:text-gray-400">
        {t('editSource.speechEmpty')}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full overflow-y-auto p-4 space-y-3">
      {speechActions.map((action) => (
        <SpeechActionRow
          key={action.audioId}
          action={action}
          highlighted={action.audioId === focusAudioId}
          onTextChange={(text) => onTextChange(action.audioId!, text)}
          t={t}
        />
      ))}
    </div>
  );
}

interface SpeechActionRowProps {
  action: SpeechAction;
  highlighted: boolean;
  onTextChange: (text: string) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

function SpeechActionRow({ action, highlighted, onTextChange, t }: SpeechActionRowProps) {
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const playerRef = useRef<AudioPlayer | null>(null);
  const stale = isSpeechAudioStale(action);

  const handleRegen = useCallback(async () => {
    if (!action.audioId || !action.text.trim()) return;
    setBusy(true);
    try {
      const result = await regenerateSingleSpeechAudio(action.audioId, action.text);
      if (result.success) {
        toast.success(t('speech.regenSuccess'));
      } else {
        toast.error(result.error || t('speech.regenFailed'));
      }
    } finally {
      setBusy(false);
    }
  }, [action, t]);

  const handlePlay = useCallback(async () => {
    if (!action.audioId) return;
    if (!playerRef.current) playerRef.current = new AudioPlayer();
    if (playing) {
      playerRef.current.stop();
      setPlaying(false);
      return;
    }
    setPlaying(true);
    playerRef.current.onEnded(() => setPlaying(false));
    const ok = await playerRef.current.play(action.audioId, action.audioUrl);
    if (!ok) {
      setPlaying(false);
      toast.error(t('speech.previewMissing'));
    }
  }, [action.audioId, action.audioUrl, playing, t]);

  // Stop preview audio when the row unmounts to avoid lingering playback.
  useEffect(() => {
    return () => {
      playerRef.current?.stop();
    };
  }, []);

  return (
    <div
      data-audio-id={action.audioId}
      className={cn(
        'rounded-lg border p-3 bg-white dark:bg-gray-900 transition-colors',
        highlighted
          ? 'border-purple-300 dark:border-purple-700 ring-2 ring-purple-200 dark:ring-purple-800'
          : 'border-gray-200 dark:border-gray-800',
      )}
    >
      <div className="flex items-center justify-between mb-2 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] font-mono text-gray-400 truncate">
            {action.audioId}
          </span>
          {stale && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="size-3" />
              {t('speech.staleBadge')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={handlePlay}
            disabled={busy || (!action.audioId && !action.audioUrl)}
            className="p-1.5 rounded-md text-gray-500 hover:text-purple-600 dark:hover:text-purple-400 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 transition-colors"
            title={playing ? t('speech.previewStop') : t('speech.preview')}
          >
            <Play className={cn('size-3.5', playing && 'fill-purple-500 text-purple-500')} />
          </button>
          <button
            type="button"
            onClick={handleRegen}
            disabled={busy || !action.text.trim()}
            className={cn(
              'inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors',
              stale
                ? 'bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50'
                : 'text-gray-500 hover:text-purple-600 dark:hover:text-purple-400 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40',
            )}
            title={t('speech.regenerateOne')}
          >
            {busy ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <RefreshCw className="size-3" />
            )}
            {busy ? t('speech.regenerating') : t('speech.regenerateOne')}
          </button>
        </div>
      </div>
      <textarea
        value={action.text}
        onChange={(e) => onTextChange(e.target.value)}
        rows={3}
        className="w-full px-2 py-1.5 rounded-md border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 text-xs text-gray-800 dark:text-gray-200 resize-y focus:outline-none focus:ring-1 focus:ring-purple-400"
      />
    </div>
  );
}
