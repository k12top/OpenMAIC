'use client';

import { useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  PanelLeftClose,
  PieChart,
  Cpu,
  MousePointer2,
  BookOpen,
  Globe,
  AlertCircle,
  RefreshCw,
  Coins,
  GripVertical,
  Trash2,
} from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils';
import { BRAND_NAME } from '@/lib/constants/brand';
import { ThumbnailSlide } from '@/components/slide-renderer/components/ThumbnailSlide';
import { useStageStore, useCanvasStore } from '@/lib/store';
import { useI18n } from '@/lib/hooks/use-i18n';
import type { Scene, SceneType, SlideContent } from '@/lib/types/stage';
import { PENDING_SCENE_ID } from '@/lib/store/stage';
import { useCan } from '@/components/auth/can';

interface SceneSidebarProps {
  readonly collapsed: boolean;
  readonly onCollapseChange: (collapsed: boolean) => void;
  readonly onSceneSelect?: (sceneId: string) => void;
  readonly onRetryOutline?: (outlineId: string) => Promise<void>;
}

const DEFAULT_WIDTH = 220;
const MIN_WIDTH = 170;
const MAX_WIDTH = 400;

export function SceneSidebar({
  collapsed,
  onCollapseChange,
  onSceneSelect,
  onRetryOutline,
}: SceneSidebarProps) {
  const { t } = useI18n();
  const router = useRouter();
  const { scenes, currentSceneId, setCurrentSceneId, generatingOutlines, generationStatus } =
    useStageStore();
  const failedOutlines = useStageStore.use.failedOutlines();
  const creditsInsufficient = useStageStore.use.creditsInsufficient();
  const regeneratingSceneIds = useStageStore.use.regeneratingSceneIds();
  const isSharedView = useStageStore.use.isSharedView();
  const reorderScenes = useStageStore.use.reorderScenes();
  const deleteScene = useStageStore.use.deleteScene();
  const viewportSize = useCanvasStore.use.viewportSize();
  const viewportRatio = useCanvasStore.use.viewportRatio();

  // Permission-gated management affordances (drag to reorder, hover to
  // delete). Never shown on shared views — shared viewers are always
  // treated as non-owners even if the underlying session happens to
  // belong to them. `useCan` respects classroom ownership AND RBAC.
  const canReorder = useCan('reorder');
  const canDeleteScene = useCan('delete-scene');
  const showOwnerControls = (canReorder || canDeleteScene) && !isSharedView;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const ids = scenes.map((s) => s.id);
      const oldIndex = ids.indexOf(String(active.id));
      const newIndex = ids.indexOf(String(over.id));
      if (oldIndex === -1 || newIndex === -1) return;
      const next = arrayMove(ids, oldIndex, newIndex);
      reorderScenes(next);
    },
    [scenes, reorderScenes],
  );

  const handleDeleteScene = useCallback(
    (sceneId: string, title: string) => {
      if (typeof window === 'undefined') return;
      const ok = window.confirm(
        t('stage.confirmDeleteScene', { title }) ||
          `Delete scene "${title}"? This cannot be undone.`,
      );
      if (!ok) return;
      deleteScene(sceneId);
    },
    [deleteScene, t],
  );

  const [retryingOutlineId, setRetryingOutlineId] = useState<string | null>(null);

  const handleRetryOutline = async (outlineId: string) => {
    if (!onRetryOutline) return;
    setRetryingOutlineId(outlineId);
    try {
      await onRetryOutline(outlineId);
    } finally {
      setRetryingOutlineId(null);
    }
  };

  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_WIDTH);
  const isDraggingRef = useRef(false);

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDraggingRef.current = true;
      const startX = e.clientX;
      const startWidth = sidebarWidth;

      const handleMouseMove = (me: MouseEvent) => {
        const delta = me.clientX - startX;
        const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta));
        setSidebarWidth(newWidth);
      };

      const handleMouseUp = () => {
        isDraggingRef.current = false;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [sidebarWidth],
  );

  const getSceneTypeIcon = (type: SceneType) => {
    const icons = {
      slide: BookOpen,
      quiz: PieChart,
      interactive: MousePointer2,
      pbl: Cpu,
    };
    return icons[type] || BookOpen;
  };

  const displayWidth = collapsed ? 0 : sidebarWidth;

  return (
    <div
      style={{
        width: displayWidth,
        transition: isDraggingRef.current ? 'none' : 'width 0.3s ease',
      }}
      className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-r border-gray-100 dark:border-gray-800 shadow-[2px_0_24px_rgba(0,0,0,0.02)] flex flex-col shrink-0 z-20 relative overflow-visible"
    >
      {/* Drag handle */}
      {!collapsed && (
        <div
          onMouseDown={handleDragStart}
          className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize z-50 group hover:bg-purple-400/30 dark:hover:bg-purple-600/30 active:bg-purple-500/40 dark:active:bg-purple-500/40 transition-colors"
        >
          <div className="absolute right-0.5 top-1/2 -translate-y-1/2 w-0.5 h-8 rounded-full bg-gray-300 dark:bg-gray-600 group-hover:bg-purple-400 dark:group-hover:bg-purple-500 transition-colors" />
        </div>
      )}

      <div className={cn('flex flex-col w-full h-full overflow-hidden', collapsed && 'hidden')}>
        {/* Logo Header */}
        <div className="h-10 flex items-center justify-between shrink-0 relative mt-3 mb-1 px-3">
          {isSharedView ? (
            <div className="flex items-center gap-2 px-1.5 -mx-1.5 py-1 -my-1">
              <span className="text-sm font-semibold text-foreground truncate max-w-[11rem]">
                {BRAND_NAME}
              </span>
            </div>
          ) : (
            <button
              onClick={() => router.push('/')}
              className="flex items-center gap-2 cursor-pointer rounded-lg px-1.5 -mx-1.5 py-1 -my-1 hover:bg-gray-100/80 dark:hover:bg-gray-800/60 active:scale-[0.97] transition-all duration-150"
              title={t('generation.backToHome')}
            >
              <span className="text-sm font-semibold text-foreground truncate max-w-[11rem]">
                {BRAND_NAME}
              </span>
            </button>
          )}
          <button
            onClick={() => onCollapseChange(true)}
            className="w-7 h-7 shrink-0 rounded-lg flex items-center justify-center bg-gray-100/80 dark:bg-gray-800/80 text-gray-500 dark:text-gray-400 ring-1 ring-black/[0.04] dark:ring-white/[0.06] hover:bg-gray-200/90 dark:hover:bg-gray-700/90 hover:text-gray-700 dark:hover:text-gray-200 active:scale-90 transition-all duration-200"
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
        </div>

        {/* Insufficient Credits Banner */}
        {creditsInsufficient && (
          <div className="mx-2 mb-1 p-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-700/40 flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <Coins className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                Insufficient Credits
              </span>
            </div>
            <p className="text-[10px] text-amber-600/80 dark:text-amber-500/80 leading-snug">
              Generation paused. Please recharge to continue.
            </p>
            <a
              href="/credits"
              className="text-[10px] font-medium text-blue-600 dark:text-blue-400 hover:underline"
            >
              Go to Credits →
            </a>
          </div>
        )}

        {/* Scenes List */}
        <div
          data-testid="scene-list"
          className="flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-2 scrollbar-hide pt-1"
        >
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={scenes.map((s) => s.id)}
              strategy={verticalListSortingStrategy}
            >
              {scenes.map((scene, index) => {
                const isActive = currentSceneId === scene.id;
                const isSlide = scene.type === 'slide';
                const slideContent = isSlide ? (scene.content as SlideContent) : null;
                const isRegenerating = regeneratingSceneIds.includes(scene.id);
                return (
                  <SortableSceneCard
                    key={scene.id}
                    scene={scene}
                    index={index}
                    isActive={isActive}
                    isRegenerating={isRegenerating}
                    slideContent={slideContent}
                    getSceneTypeIcon={getSceneTypeIcon}
                    onSelect={() => {
                      if (onSceneSelect) onSceneSelect(scene.id);
                      else setCurrentSceneId(scene.id);
                    }}
                    showOwnerControls={showOwnerControls}
                    canReorder={canReorder && !isSharedView}
                    canDelete={canDeleteScene && !isSharedView}
                    sidebarWidth={sidebarWidth}
                    viewportSize={viewportSize}
                    viewportRatio={viewportRatio}
                    regeneratingLabel={t('stage.regenerating')}
                    onDeleteClick={(id, title) => handleDeleteScene(id, title)}
                    dragDisabled={isRegenerating || !(canReorder && !isSharedView)}
                  />
                );
              })}
            </SortableContext>
          </DndContext>

          {/* Single placeholder for the next generating page (clickable) */}
          {generatingOutlines.length > 0 &&
            (() => {
              const outline = generatingOutlines[0];
              const isFailed = failedOutlines.some((f) => f.id === outline.id);
              const isRetrying = retryingOutlineId === outline.id;
              const isPaused = generationStatus === 'paused';
              const isActive = currentSceneId === PENDING_SCENE_ID;

              return (
                <div
                  key={`generating-${outline.id}`}
                  onClick={() => {
                    if (isFailed) return;
                    if (onSceneSelect) {
                      onSceneSelect(PENDING_SCENE_ID);
                    } else {
                      setCurrentSceneId(PENDING_SCENE_ID);
                    }
                  }}
                  className={cn(
                    'group relative rounded-lg flex flex-col gap-1 p-1.5 transition-all duration-200',
                    isFailed
                      ? 'opacity-100 cursor-default'
                      : 'cursor-pointer hover:bg-gray-50/80 dark:hover:bg-gray-800/50',
                    !isFailed && !isActive && 'opacity-60',
                    isActive &&
                      !isFailed &&
                      'bg-purple-50 dark:bg-purple-900/20 ring-1 ring-purple-200 dark:ring-purple-700 opacity-100',
                  )}
                >
                  {/* Scene Header */}
                  <div className="flex justify-between items-center px-2 pt-0.5">
                    <div className="flex items-center gap-2 max-w-full">
                      <span
                        className={cn(
                          'text-[10px] font-black w-4 h-4 rounded-full flex items-center justify-center shrink-0',
                          isActive && !isFailed
                            ? 'bg-purple-600 dark:bg-purple-500 text-white shadow-sm shadow-purple-500/30'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500',
                        )}
                      >
                        {scenes.length + 1}
                      </span>
                      <span
                        className={cn(
                          'text-xs font-bold truncate transition-colors',
                          isActive && !isFailed
                            ? 'text-purple-700 dark:text-purple-300'
                            : isFailed
                              ? 'text-gray-700 dark:text-gray-200'
                              : 'text-gray-400 dark:text-gray-500',
                        )}
                      >
                        {outline.title}
                      </span>
                    </div>
                  </div>

                  {/* Skeleton Thumbnail */}
                  <div
                    className={cn(
                      'relative aspect-video w-full rounded overflow-hidden ring-1',
                      isFailed
                        ? 'bg-red-50/30 dark:bg-red-950/10 ring-red-100 dark:ring-red-900/20'
                        : 'bg-gray-100 dark:bg-gray-800 ring-black/5 dark:ring-white/5',
                    )}
                  >
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5">
                      {creditsInsufficient && isPaused ? (
                        <div className="flex flex-col items-center gap-1 px-1">
                          <Coins className="w-4 h-4 text-amber-500" />
                          <span className="text-[9px] font-medium text-amber-600 dark:text-amber-400 text-center leading-tight">
                            Insufficient Credits
                          </span>
                          <a
                            href="/credits"
                            onClick={(e) => e.stopPropagation()}
                            className="text-[8px] text-blue-500 hover:underline"
                          >
                            Recharge
                          </a>
                        </div>
                      ) : isFailed ? (
                        <div className="flex items-center gap-1 text-xs font-medium text-red-500/90 dark:text-red-400">
                          {onRetryOutline ? (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRetryOutline(outline.id);
                              }}
                              disabled={isRetrying}
                              className="p-1 -ml-1 rounded-md hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors active:scale-95 disabled:opacity-50 disabled:active:scale-100"
                              title={t('generation.retryScene')}
                            >
                              <RefreshCw
                                className={cn('w-3.5 h-3.5', isRetrying && 'animate-spin')}
                              />
                            </button>
                          ) : (
                            <AlertCircle className="w-3.5 h-3.5" />
                          )}
                          <span>
                            {isRetrying
                              ? t('generation.retryingScene')
                              : t('stage.generationFailed')}
                          </span>
                        </div>
                      ) : (
                        <>
                          <div
                            className={cn(
                              'h-2 w-3/5 bg-gray-200 dark:bg-gray-700 rounded',
                              !isPaused && 'animate-pulse',
                            )}
                          />
                          <div
                            className={cn(
                              'h-1.5 w-2/5 bg-gray-200 dark:bg-gray-700 rounded',
                              !isPaused && 'animate-pulse',
                            )}
                          />
                          <span className="text-[9px] font-medium text-gray-400 dark:text-gray-500 mt-0.5">
                            {isPaused ? t('stage.paused') : t('stage.generating')}
                          </span>
                        </>
                      )}
                    </div>
                    {!isFailed && !isPaused && (
                      <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/40 dark:via-white/10 to-transparent" />
                    )}
                  </div>
                </div>
              );
            })()}
        </div>

        {/* Spacer to push toggle button area */}
        <div className="mt-auto" />
      </div>
    </div>
  );
}

interface SortableSceneCardProps {
  readonly scene: Scene;
  readonly index: number;
  readonly isActive: boolean;
  readonly isRegenerating: boolean;
  readonly slideContent: SlideContent | null;
  readonly getSceneTypeIcon: (type: SceneType) => React.ComponentType<{ className?: string }>;
  readonly onSelect: () => void;
  readonly showOwnerControls: boolean;
  readonly canReorder: boolean;
  readonly canDelete: boolean;
  readonly sidebarWidth: number;
  readonly viewportSize: number;
  readonly viewportRatio: number;
  readonly regeneratingLabel: string;
  readonly onDeleteClick: (sceneId: string, title: string) => void;
  readonly dragDisabled: boolean;
}

function SortableSceneCard({
  scene,
  index,
  isActive,
  isRegenerating,
  slideContent,
  getSceneTypeIcon,
  onSelect,
  showOwnerControls,
  canReorder,
  canDelete,
  sidebarWidth,
  viewportSize,
  viewportRatio,
  regeneratingLabel,
  onDeleteClick,
  dragDisabled,
}: SortableSceneCardProps) {
  const Icon = getSceneTypeIcon(scene.type);
  const isSlide = scene.type === 'slide';

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: scene.id,
    disabled: dragDisabled,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid="scene-item"
      onClick={onSelect}
      className={cn(
        'group relative rounded-lg transition-all duration-200 cursor-pointer flex flex-col gap-1 p-1.5',
        isActive
          ? 'bg-purple-50 dark:bg-purple-900/20 ring-1 ring-purple-200 dark:ring-purple-700'
          : 'hover:bg-gray-50/80 dark:hover:bg-gray-800/50',
      )}
    >
      {/* Scene Header */}
      <div className="flex justify-between items-center px-2 pt-0.5">
        <div className="flex items-center gap-2 max-w-full min-w-0">
          <span
            className={cn(
              'text-[10px] font-black w-4 h-4 rounded-full flex items-center justify-center shrink-0',
              isActive
                ? 'bg-purple-600 dark:bg-purple-500 text-white shadow-sm shadow-purple-500/30'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400',
            )}
          >
            {index + 1}
          </span>
          <span
            data-testid="scene-title"
            className={cn(
              'text-xs font-bold truncate transition-colors',
              isActive
                ? 'text-purple-700 dark:text-purple-300'
                : 'text-gray-600 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-gray-100',
            )}
          >
            {scene.title}
          </span>
        </div>
        {/* Owner-only controls: drag handle + delete (hover to reveal) */}
        {showOwnerControls && !isRegenerating && (
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
            {canReorder && (
              <button
                type="button"
                aria-label="Reorder"
                onClick={(e) => e.stopPropagation()}
                className="p-0.5 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-200/60 dark:hover:bg-gray-700/60 cursor-grab active:cursor-grabbing touch-none"
                {...attributes}
                {...listeners}
              >
                <GripVertical className="w-3 h-3" />
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                aria-label="Delete scene"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteClick(scene.id, scene.title);
                }}
                className="p-0.5 rounded text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Thumbnail */}
      <div className="relative aspect-video w-full rounded overflow-hidden bg-gray-100 dark:bg-gray-800 ring-1 ring-black/5 dark:ring-white/5">
        {isRegenerating && (
          <div className="absolute inset-0 z-10 bg-white/70 dark:bg-black/50 backdrop-blur-[1px] flex flex-col items-center justify-center gap-1">
            <RefreshCw className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 animate-spin" />
            <span className="text-[9px] font-semibold text-purple-700 dark:text-purple-300">
              {regeneratingLabel}
            </span>
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center">
          {isSlide && slideContent ? (
            <ThumbnailSlide
              slide={slideContent.canvas}
              viewportSize={viewportSize}
              viewportRatio={viewportRatio}
              size={Math.max(100, sidebarWidth - 28)}
            />
          ) : scene.type === 'quiz' ? (
            <div className="w-full h-full bg-gradient-to-br from-orange-50 to-amber-50 dark:from-orange-950/30 dark:to-amber-950/20 p-2 flex flex-col">
              <div className="h-1.5 w-4/5 bg-orange-200/70 dark:bg-orange-700/30 rounded-full mb-1.5" />
              <div className="flex-1 grid grid-cols-2 gap-1">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className={cn(
                      'rounded flex items-center gap-1 px-1',
                      i === 1
                        ? 'bg-orange-400/20 dark:bg-orange-500/20 border border-orange-300/50 dark:border-orange-600/30'
                        : 'bg-white/60 dark:bg-white/5 border border-orange-100/60 dark:border-orange-800/20',
                    )}
                  >
                    <div
                      className={cn(
                        'w-1.5 h-1.5 rounded-full shrink-0',
                        i === 1
                          ? 'bg-orange-400 dark:bg-orange-500'
                          : 'bg-orange-200 dark:bg-orange-700/50',
                      )}
                    />
                    <div
                      className={cn(
                        'h-1 rounded-full flex-1',
                        i === 1
                          ? 'bg-orange-300/60 dark:bg-orange-600/40'
                          : 'bg-orange-100/80 dark:bg-orange-800/30',
                      )}
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : scene.type === 'interactive' ? (
            <div className="w-full h-full bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/20 p-1.5 flex flex-col">
              <div className="flex items-center gap-1 mb-1 pb-1 border-b border-emerald-200/40 dark:border-emerald-700/20">
                <div className="flex gap-0.5">
                  <div className="w-1 h-1 rounded-full bg-red-300 dark:bg-red-500/60" />
                  <div className="w-1 h-1 rounded-full bg-amber-300 dark:bg-amber-500/60" />
                  <div className="w-1 h-1 rounded-full bg-green-300 dark:bg-green-500/60" />
                </div>
                <div className="h-1.5 flex-1 bg-emerald-200/40 dark:bg-emerald-700/30 rounded-full ml-0.5" />
              </div>
              <div className="flex-1 flex gap-1">
                <div className="w-1/4 space-y-1 pt-0.5">
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="h-0.5 w-full bg-emerald-200/60 dark:bg-emerald-700/30 rounded-full"
                    />
                  ))}
                </div>
                <div className="flex-1 bg-emerald-100/40 dark:bg-emerald-800/20 rounded flex items-center justify-center border border-emerald-200/40 dark:border-emerald-700/20">
                  <Globe className="w-4 h-4 text-emerald-300/80 dark:text-emerald-600/50" />
                </div>
              </div>
            </div>
          ) : scene.type === 'pbl' ? (
            <div className="w-full h-full bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/20 p-1.5 flex flex-col">
              <div className="flex items-center gap-1 mb-1.5">
                <div className="w-1.5 h-1.5 rounded bg-blue-300 dark:bg-blue-600" />
                <div className="h-1 w-8 bg-blue-200/60 dark:bg-blue-700/30 rounded-full" />
              </div>
              <div className="flex-1 flex gap-1 overflow-hidden">
                {[0, 1, 2].map((col) => (
                  <div
                    key={col}
                    className="flex-1 bg-white/50 dark:bg-white/5 rounded p-0.5 flex flex-col gap-0.5"
                  >
                    <div
                      className={cn(
                        'h-0.5 w-3 rounded-full mb-0.5',
                        col === 0
                          ? 'bg-blue-300/70'
                          : col === 1
                            ? 'bg-amber-300/70'
                            : 'bg-green-300/70',
                      )}
                    />
                    {Array.from({
                      length: col === 0 ? 3 : col === 1 ? 2 : 1,
                    }).map((_, i) => (
                      <div
                        key={i}
                        className="h-2 w-full bg-blue-100/60 dark:bg-blue-800/20 rounded border border-blue-200/30 dark:border-blue-700/20"
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center gap-1 bg-gray-50 dark:bg-gray-800 text-gray-300 dark:text-gray-500">
              <Icon className="w-4 h-4" />
              <span className="text-[9px] font-bold uppercase tracking-wider opacity-80">
                {scene.type}
              </span>
            </div>
          )}

          {isSlide && (
            <div
              className={cn(
                'absolute inset-0 bg-purple-500/0 transition-colors',
                isActive
                  ? 'bg-purple-500/0'
                  : 'group-hover:bg-black/5 dark:group-hover:bg-white/5',
              )}
            />
          )}
        </div>
      </div>
    </div>
  );
}
