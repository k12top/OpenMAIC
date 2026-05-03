'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Play,
  Pause,
  PencilLine,
  LayoutList,
  MessageSquare,
  Volume1,
  Volume2,
  VolumeX,
  Repeat,
  Maximize2,
  Minimize2,
  RefreshCw,
  Code2,
  Presentation,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useStageStore } from '@/lib/store';
import { useI18n } from '@/lib/hooks/use-i18n';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { EditSceneSourceDialog } from '@/components/stage/edit-scene-source-dialog';
import { useCan } from '@/components/auth/can';
import { useMenuPerm } from '@/components/auth/menu-gate';

export interface CanvasToolbarProps {
  readonly currentSceneIndex: number;
  readonly scenesCount: number;
  readonly engineState: 'idle' | 'playing' | 'paused';
  readonly isLiveSession?: boolean;
  readonly whiteboardOpen: boolean;
  readonly sidebarCollapsed?: boolean;
  readonly chatCollapsed?: boolean;
  readonly onToggleSidebar?: () => void;
  readonly onToggleChat?: () => void;
  readonly onPrevSlide: () => void;
  readonly onNextSlide: () => void;
  readonly onPlayPause: () => void;
  readonly onWhiteboardClose: () => void;
  readonly showStopDiscussion?: boolean;
  readonly onStopDiscussion?: () => void;
  readonly isPresenting?: boolean;
  readonly onTogglePresentation?: () => void;
  readonly className?: string;
  // Audio/playback controls
  readonly ttsEnabled?: boolean;
  readonly ttsMuted?: boolean;
  readonly ttsVolume?: number;
  readonly onToggleMute?: () => void;
  readonly onVolumeChange?: (volume: number) => void;
  readonly autoPlayLecture?: boolean;
  readonly onToggleAutoPlay?: () => void;
  readonly playbackSpeed?: number;
  readonly onCycleSpeed?: () => void;
  /**
   * Owner-only: regenerate the currently visible scene. When provided AND the
   * viewer owns the classroom (`useStageStore.isOwner`), a RefreshCw button is
   * rendered alongside the playback controls.
   */
  readonly onRegenerateScene?: () => void;
}

/* Compact control button */
const ctrlBtn = cn(
  'relative w-7 h-7 rounded-md flex items-center justify-center',
  'transition-all duration-150 outline-none cursor-pointer',
  'hover:bg-gray-500/[0.08] dark:hover:bg-gray-400/[0.08] active:scale-90',
);

/* Subtle separator */
function CtrlDivider() {
  return <div className="w-px h-3 bg-gray-200/80 dark:bg-gray-700/60 mx-0.5 shrink-0" />;
}

/* Volume icon based on level */
function VolumeIcon({
  muted,
  volume,
  disabled,
}: {
  muted: boolean;
  volume: number;
  disabled: boolean;
}) {
  const cls = 'w-3.5 h-3.5';
  if (disabled || muted || volume === 0) return <VolumeX className={cls} />;
  if (volume < 0.5) return <Volume1 className={cls} />;
  return <Volume2 className={cls} />;
}

export function CanvasToolbar({
  currentSceneIndex,
  scenesCount,
  engineState,
  isLiveSession,
  whiteboardOpen,
  sidebarCollapsed,
  chatCollapsed,
  onToggleSidebar,
  onToggleChat,
  onPrevSlide,
  onNextSlide,
  onPlayPause,
  onWhiteboardClose,
  showStopDiscussion,
  onStopDiscussion,
  isPresenting,
  onTogglePresentation,
  className,
  ttsEnabled,
  ttsMuted,
  ttsVolume = 1,
  onToggleMute,
  onVolumeChange,
  autoPlayLecture,
  onToggleAutoPlay,
  playbackSpeed = 1,
  onCycleSpeed,
  onRegenerateScene,
}: CanvasToolbarProps) {
  const { t } = useI18n();
  const canGoPrev = currentSceneIndex > 0;
  const canGoNext = currentSceneIndex < scenesCount - 1;
  const showPlayPause = !isLiveSession;

  const whiteboardElementCount = useStageStore(
    (s) => s.stage?.whiteboard?.[0]?.elements?.length || 0,
  );
  // Permission-gated buttons. `useCan` already respects classroom ownership
  // (owners implicitly get regenerate/edit-source) and consults RBAC env for
  // non-owners. On shared views we additionally hide edit-source because
  // structural edits via the raw JSON editor can conflict with a live
  // in-browser viewer session (hot-swapping scenes mid-render).
  const isSharedView = useStageStore((s) => s.isSharedView);
  const isOwner = useStageStore((s) => s.isOwner);
  const canRegenerate = useCan('regenerate');
  const canEditSource = useCan('edit-source');
  const showRegenerate = !!onRegenerateScene && canRegenerate;
  const showEditSource = canEditSource && !isSharedView;
  // Lecture-mode toggle is RBAC-driven via `toolbar.lectureMode` (the menu
  // entry's owner-bypass automatically grants the original author). Click
  // semantics depend on the viewer's relationship to the source classroom:
  //  - Author (or non-shared session): write through `setLectureMode` so the
  //    change persists to the stage and propagates via debouncedSave.
  //  - Other "teacher" viewers on a share link: flip `stage.lectureMode`
  //    directly via `setState` so the change is purely local — never sent
  //    to the cloud, never seen by other viewers.
  // We deliberately drop the previous `lectureMode === true` gate on the
  // viewer branch: any teacher should be able to enter / leave lecture mode
  // regardless of how the author saved the share.
  const canLectureToggle = useMenuPerm('toolbar.lectureMode', 'operable');
  const lectureMode = useStageStore((s) => !!s.stage?.lectureMode);
  const setLectureMode = useStageStore((s) => s.setLectureMode);
  const lectureWritesCloud = !isSharedView || isOwner;
  const showLectureToggle = canLectureToggle;
  const lectureToggleDisabled = !!isLiveSession;
  // Is the currently visible scene being regenerated? When true, swap the
  // icon for a spinner and disable clicks to prevent double-submits.
  const currentSceneId = useStageStore((s) => s.currentSceneId);
  const regeneratingSceneIds = useStageStore((s) => s.regeneratingSceneIds);
  const isCurrentRegenerating = !!currentSceneId && regeneratingSceneIds.includes(currentSceneId);

  // Source-editor dialog — driven entirely from this toolbar so we avoid
  // threading another callback prop through stage.tsx / roundtable.
  const [editSourceSceneId, setEditSourceSceneId] = useState<string | null>(null);

  // Volume slider hover state
  const [volumeHover, setVolumeHover] = useState(false);
  const volumeTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const volumeContainerRef = useRef<HTMLDivElement>(null);

  const handleVolumeEnter = useCallback(() => {
    clearTimeout(volumeTimerRef.current);
    setVolumeHover(true);
  }, []);

  const handleVolumeLeave = useCallback(() => {
    volumeTimerRef.current = setTimeout(() => setVolumeHover(false), 300);
  }, []);

  // Cleanup volume hover timer on unmount
  useEffect(() => () => clearTimeout(volumeTimerRef.current), []);

  // Effective volume for display
  const effectiveVolume = ttsMuted ? 0 : ttsVolume;
  const presentationLabel = isPresenting ? t('stage.exitFullscreen') : t('stage.fullscreen');

  return (
    <div className={cn('flex flex-wrap items-center justify-center gap-x-2 gap-y-1.5', className)}>
      {/* ── Left: sidebar toggle + page indicator ── */}
      <div className="flex items-center gap-1 shrink-0 pl-1">
        {onToggleSidebar && (
          <button
            onClick={onToggleSidebar}
            className={cn(
              ctrlBtn,
              'w-6 h-6',
              sidebarCollapsed
                ? 'text-gray-400 dark:text-gray-500'
                : 'text-gray-600 dark:text-gray-300',
            )}
            aria-label="Toggle sidebar"
          >
            <LayoutList className="w-3.5 h-3.5" />
          </button>
        )}
        <span className="text-[11px] text-gray-400 dark:text-gray-500 tabular-nums select-none font-medium">
          {currentSceneIndex + 1}
          <span className="opacity-35 mx-px">/</span>
          {scenesCount}
        </span>
      </div>

      <CtrlDivider />

      {/* ── Center: unified playback controls ── */}
      <div className="flex-1 flex items-center justify-center min-w-0">
        <div
          className={cn(
            'flex flex-wrap items-center justify-center gap-0.5 px-1 min-h-[28px] py-0.5',
            isPresenting
              ? '' /* Single visual layer in fullscreen — buttons sit inside outer pill directly */
              : 'bg-gray-100/60 dark:bg-gray-800/60 rounded-lg',
          )}
        >
          {/* Volume with vertical popover slider */}
          {onToggleMute && (
            <div
              ref={volumeContainerRef}
              className="relative flex items-center"
              onMouseEnter={handleVolumeEnter}
              onMouseLeave={handleVolumeLeave}
            >
              <button
                onClick={onToggleMute}
                disabled={!ttsEnabled}
                className={cn(
                  ctrlBtn,
                  'w-6 h-6',
                  !ttsEnabled
                    ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                    : ttsMuted
                      ? 'text-red-500 dark:text-red-400'
                      : 'text-gray-500 dark:text-gray-400',
                )}
                aria-label={ttsMuted ? 'Unmute' : 'Mute'}
              >
                <VolumeIcon muted={!!ttsMuted} volume={ttsVolume} disabled={!ttsEnabled} />
              </button>

              {/* Vertical volume slider (pops up above) */}
              <div
                className={cn(
                  'absolute bottom-full left-1/2 -translate-x-1/2 mb-2 flex flex-col items-center',
                  'transition-all duration-200 ease-out pointer-events-none opacity-0',
                  volumeHover && ttsEnabled && 'pointer-events-auto opacity-100',
                )}
              >
                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg px-2 py-2.5 flex flex-col items-center gap-1.5">
                  <span className="text-[10px] text-gray-400 dark:text-gray-500 tabular-nums font-medium select-none">
                    {Math.round(effectiveVolume * 100)}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={effectiveVolume}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      onVolumeChange?.(v);
                      if (v > 0 && ttsMuted) onToggleMute?.();
                    }}
                    className={cn(
                      'appearance-none cursor-pointer',
                      'h-16 w-1 rounded-full',
                      'bg-gray-200 dark:bg-gray-600',
                      '[writing-mode:vertical-lr] [direction:rtl]',
                      '[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3',
                      '[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-violet-500 [&::-webkit-slider-thumb]:dark:bg-violet-400',
                      '[&::-webkit-slider-thumb]:shadow-sm [&::-webkit-slider-thumb]:cursor-pointer',
                      '[&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3',
                      '[&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-violet-500 [&::-moz-range-thumb]:border-0',
                    )}
                  />
                </div>
                {/* Arrow pointing down */}
                <div className="w-2 h-2 bg-white dark:bg-gray-800 border-b border-r border-gray-200 dark:border-gray-700 rotate-45 -mt-[5px]" />
              </div>
            </div>
          )}

          {/* Speed */}
          {onCycleSpeed && (
            <TooltipProvider delayDuration={0}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={onCycleSpeed}
                    className={cn(
                      'w-8 h-5 rounded flex items-center justify-center',
                      'transition-all duration-150 outline-none cursor-pointer',
                      'text-[11px] font-semibold tabular-nums leading-none',
                      'active:scale-90',
                      playbackSpeed !== 1
                        ? 'text-violet-600 dark:text-violet-400 bg-violet-500/10 dark:bg-violet-400/10'
                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200',
                    )}
                    aria-label="Playback speed"
                  >
                    {playbackSpeed === 1.5 ? '1.5x' : `${playbackSpeed}x`}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  {t('roundtable.speed')}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          <CtrlDivider />

          {/* Prev scene */}
          {scenesCount > 1 && (
            <button
              onClick={onPrevSlide}
              disabled={!canGoPrev}
              className={cn(
                ctrlBtn,
                'w-6 h-6 text-gray-500 dark:text-gray-400 disabled:opacity-20 disabled:pointer-events-none',
              )}
              aria-label="Previous scene"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Play / Pause / Stop Discussion */}
          {showStopDiscussion && onStopDiscussion ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onStopDiscussion();
              }}
              className={cn(
                'flex items-center gap-1.5 h-6 px-2.5 rounded-md',
                'bg-red-500/10 dark:bg-red-400/10 text-red-600 dark:text-red-400',
                'text-[11px] font-semibold whitespace-nowrap',
                'hover:bg-red-500/20 dark:hover:bg-red-400/20 active:scale-95 transition-all cursor-pointer',
              )}
              title={t('roundtable.stopDiscussion')}
            >
              <span className="relative flex h-1.5 w-1.5 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500" />
              </span>
              {t('roundtable.stopDiscussion')}
            </button>
          ) : showPlayPause && !lectureMode ? (
            <button
              onClick={onPlayPause}
              className={cn(
                ctrlBtn,
                'w-7 h-6',
                engineState === 'playing'
                  ? 'text-violet-600 dark:text-violet-400'
                  : 'text-gray-500 dark:text-gray-400',
              )}
              aria-label={engineState === 'playing' ? 'Pause' : 'Play'}
            >
              {engineState === 'playing' ? (
                <Pause className="w-3.5 h-3.5" />
              ) : (
                <Play className="w-3.5 h-3.5 ml-px" />
              )}
            </button>
          ) : null}

          {/* Next scene */}
          {scenesCount > 1 && (
            <button
              onClick={onNextSlide}
              disabled={!canGoNext}
              className={cn(
                ctrlBtn,
                'w-6 h-6 text-gray-500 dark:text-gray-400 disabled:opacity-20 disabled:pointer-events-none',
              )}
              aria-label="Next scene"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}

          <CtrlDivider />

          {/* Lecture / Auto mode toggle.
              - Owner branch: persistent toggle, gated by toolbar.lectureMode.
              - Viewer branch: ephemeral local override on shared view (no
                cloud write, no RBAC gate, no toast). */}
          {showLectureToggle && (
            <TooltipProvider delayDuration={0}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => {
                      if (lectureToggleDisabled) return;
                      const next = !lectureMode;
                      if (lectureWritesCloud) {
                        setLectureMode(next);
                        toast.success(
                          next
                            ? t('toolbar.lectureModeOn')
                            : t('toolbar.lectureModeOff'),
                        );
                      } else {
                        useStageStore.setState((state) =>
                          state.stage
                            ? { stage: { ...state.stage, lectureMode: next } }
                            : state,
                        );
                      }
                    }}
                    disabled={lectureToggleDisabled}
                    className={cn(
                      ctrlBtn,
                      'w-8 h-6',
                      lectureToggleDisabled && 'opacity-40 cursor-not-allowed',
                      lectureMode
                        ? 'text-purple-600 dark:text-purple-400'
                        : 'text-gray-500 dark:text-gray-400',
                    )}
                    aria-label={t('toolbar.lectureModeTooltip')}
                  >
                    <Presentation className="w-3.5 h-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  {lectureMode ? t('toolbar.lectureModeOn') : t('toolbar.lectureModeOff')}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {/* Auto-play (hidden in lecture mode — auto-advance is irrelevant
              when the teacher drives advance manually) */}
          {onToggleAutoPlay && !lectureMode && (
            <TooltipProvider delayDuration={0}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={onToggleAutoPlay}
                    className={cn(
                      ctrlBtn,
                      'w-8 h-6',
                      autoPlayLecture
                        ? 'text-violet-600 dark:text-violet-400'
                        : 'text-gray-500 dark:text-gray-400',
                    )}
                    aria-label="Auto-play"
                  >
                    <Repeat className="w-3.5 h-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  {autoPlayLecture ? t('roundtable.autoPlayOff') : t('roundtable.autoPlay')}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {/* Whiteboard */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onWhiteboardClose();
            }}
            className={cn(
              ctrlBtn,
              'w-6 h-6',
              whiteboardOpen
                ? 'text-violet-600 dark:text-violet-400'
                : 'text-gray-500 dark:text-gray-400',
            )}
            title={whiteboardOpen ? t('whiteboard.minimize') : t('whiteboard.open')}
          >
            <PencilLine className="w-3.5 h-3.5" />
            {!whiteboardOpen && whiteboardElementCount > 0 && (
              <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 bg-violet-500 dark:bg-violet-400 rounded-full" />
            )}
          </button>

          {/* Regenerate current scene (owner only) */}
          {showRegenerate && (
            <TooltipProvider delayDuration={0}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isCurrentRegenerating) return;
                      onRegenerateScene?.();
                    }}
                    disabled={isCurrentRegenerating}
                    className={cn(
                      ctrlBtn,
                      'w-6 h-6',
                      isCurrentRegenerating
                        ? 'text-purple-600 dark:text-purple-400 cursor-wait'
                        : 'text-gray-500 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-400',
                    )}
                    aria-label={t('stage.regenerateScene')}
                  >
                    <RefreshCw
                      className={cn('w-3.5 h-3.5', isCurrentRegenerating && 'animate-spin')}
                    />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  {isCurrentRegenerating
                    ? t('stage.regenerating')
                    : t('stage.regenerateScene')}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {/* Edit source JSON (owner only) */}
          {showEditSource && (
            <TooltipProvider delayDuration={0}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!currentSceneId) return;
                      setEditSourceSceneId(currentSceneId);
                    }}
                    disabled={!currentSceneId || isCurrentRegenerating}
                    className={cn(
                      ctrlBtn,
                      'w-6 h-6 text-gray-500 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-400 disabled:opacity-40 disabled:pointer-events-none',
                    )}
                    aria-label={t('stage.editSource') || 'Edit Source'}
                  >
                    <Code2 className="w-3.5 h-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  {t('stage.editSource') || 'Edit Source'}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </div>

      {/* ── Right: fullscreen + chat toggle ── */}
      <div className="flex items-center justify-end gap-px shrink-0 pr-1">
        <CtrlDivider />
        {onTogglePresentation && (
          <button
            onClick={onTogglePresentation}
            className={cn(
              ctrlBtn,
              'w-6 h-6',
              isPresenting
                ? 'text-violet-600 dark:text-violet-400'
                : 'text-gray-500 dark:text-gray-400',
            )}
            aria-label={presentationLabel}
            title={presentationLabel}
          >
            {isPresenting ? (
              <Minimize2 className="w-3.5 h-3.5" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" />
            )}
          </button>
        )}
        {onToggleChat && (
          <button
            type="button"
            onClick={onToggleChat}
            className={cn(
              ctrlBtn,
              'w-6 h-6',
              chatCollapsed
                ? 'text-violet-600 dark:text-violet-400 ring-2 ring-violet-400/35 dark:ring-violet-500/40 rounded-md'
                : 'text-gray-600 dark:text-gray-300',
            )}
            aria-label={
              chatCollapsed ? t('toolbar.openChatPanel') : t('toolbar.toggleChat')
            }
            title={
              chatCollapsed ? t('toolbar.openChatPanel') : t('toolbar.toggleChat')
            }
          >
            <MessageSquare className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Source editor (owner only; portal-like overlay rendered at bottom) */}
      {showEditSource && (
        <EditSceneSourceDialog
          sceneId={editSourceSceneId}
          onClose={() => setEditSourceSceneId(null)}
        />
      )}
    </div>
  );
}
