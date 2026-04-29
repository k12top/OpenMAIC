'use client';

import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  CheckCircle2,
  GripVertical,
  ListChecks,
  Loader2,
  Pencil,
  Plus,
  RefreshCcw,
  Trash2,
  X,
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
import { nanoid } from 'nanoid';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/hooks/use-i18n';
import type { SceneOutline } from '@/lib/types/generation';

type SceneType = SceneOutline['type'];

const SCENE_TYPES: SceneType[] = ['slide', 'quiz', 'interactive', 'pbl'];

const SCENE_TYPE_COLORS: Record<SceneType, string> = {
  slide: 'text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/40',
  quiz: 'text-purple-600 dark:text-purple-400 bg-purple-100 dark:bg-purple-900/40',
  interactive: 'text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/40',
  pbl: 'text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/40',
};

/** Build a fresh outline of the requested type with sensible defaults so the
 *  newly-added scene is valid for downstream generation right away. */
export function createBlankOutline(order: number, type: SceneType = 'slide'): SceneOutline {
  const base: SceneOutline = {
    id: `scene_${nanoid(6)}`,
    type,
    title: '',
    description: '',
    keyPoints: [''],
    order,
  };
  return ensureTypedConfig(base, type);
}

/** Reset/seed the type-specific config field when the user changes scene type
 *  so the outline stays valid for the picked type. */
export function ensureTypedConfig(outline: SceneOutline, nextType: SceneType): SceneOutline {
  const next: SceneOutline = { ...outline, type: nextType };
  // Drop configs that don't apply to the new type
  if (nextType !== 'quiz') delete next.quizConfig;
  if (nextType !== 'interactive') delete next.interactiveConfig;
  if (nextType !== 'pbl') delete next.pblConfig;

  if (nextType === 'quiz' && !next.quizConfig) {
    next.quizConfig = {
      questionCount: 2,
      difficulty: 'medium',
      questionTypes: ['single'],
    };
  }
  if (nextType === 'interactive' && !next.interactiveConfig) {
    next.interactiveConfig = {
      conceptName: outline.title || '',
      conceptOverview: outline.description || '',
      designIdea: '',
    };
  }
  if (nextType === 'pbl' && !next.pblConfig) {
    next.pblConfig = {
      projectTopic: outline.title || '',
      projectDescription: outline.description || '',
      targetSkills: [],
      language: outline.language || 'zh-CN',
    };
  }
  return next;
}

export interface OutlineEditorProps {
  outlines: SceneOutline[];
  onChange: (next: SceneOutline[]) => void;
  onConfirm: () => void;
  onRegenerateAll: (feedback: string) => void;
  onRegenerateOne: (outlineId: string, feedback: string) => void;
  /** When true, all interactive controls are disabled (regen in progress). */
  busy: 'none' | 'all' | 'one';
  /** Outline currently being regenerated (when busy === 'one'). */
  regeneratingId?: string | null;
  /** Optional error message to surface above the action bar. */
  errorMessage?: string | null;
}

/**
 * Editable outline review panel rendered after the outline-streaming step
 * completes when the user has opted into "confirm before continue".
 */
export function OutlineEditor({
  outlines,
  onChange,
  onConfirm,
  onRegenerateAll,
  onRegenerateOne,
  busy,
  regeneratingId,
  errorMessage,
}: OutlineEditorProps) {
  const { t } = useI18n();
  const [regenAllOpen, setRegenAllOpen] = useState(false);
  const [regenAllFeedback, setRegenAllFeedback] = useState('');
  const [pendingTypeChange, setPendingTypeChange] = useState<{
    id: string;
    nextType: SceneType;
  } | null>(null);

  const totalDuration = useMemo(
    () => outlines.reduce((acc, o) => acc + (o.estimatedDuration || 0), 0),
    [outlines],
  );

  const validation = useMemo(() => validateOutlines(outlines), [outlines]);
  const canConfirm = busy === 'none' && validation.ok;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = outlines.map((o) => o.id);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(outlines, oldIndex, newIndex).map((o, i) => ({
      ...o,
      order: i + 1,
    }));
    onChange(reordered);
  };

  const updateOutline = (id: string, patch: Partial<SceneOutline>) => {
    onChange(
      outlines.map((o) =>
        o.id === id
          ? {
              ...o,
              ...patch,
            }
          : o,
      ),
    );
  };

  const removeOutline = (id: string) => {
    const next = outlines.filter((o) => o.id !== id).map((o, i) => ({ ...o, order: i + 1 }));
    onChange(next);
  };

  const addOutline = (type: SceneType = 'slide') => {
    const next = [...outlines, createBlankOutline(outlines.length + 1, type)];
    onChange(next);
  };

  const handleTypeChangeRequest = (id: string, nextType: SceneType) => {
    const current = outlines.find((o) => o.id === id);
    if (!current || current.type === nextType) return;
    // Warn before clobbering type-specific config (quizConfig, interactiveConfig, pblConfig)
    const hasTypedConfig =
      (current.type === 'quiz' && !!current.quizConfig) ||
      (current.type === 'interactive' && !!current.interactiveConfig) ||
      (current.type === 'pbl' && !!current.pblConfig);
    if (hasTypedConfig) {
      setPendingTypeChange({ id, nextType });
    } else {
      const updated = ensureTypedConfig(current, nextType);
      updateOutline(id, updated);
    }
  };

  const confirmTypeChange = () => {
    if (!pendingTypeChange) return;
    const current = outlines.find((o) => o.id === pendingTypeChange.id);
    if (current) {
      const updated = ensureTypedConfig(current, pendingTypeChange.nextType);
      updateOutline(pendingTypeChange.id, updated);
    }
    setPendingTypeChange(null);
  };

  return (
    <div className="w-full h-full flex flex-col p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 pb-4 border-b border-violet-100 dark:border-violet-900/30">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-violet-100 dark:bg-violet-900/40 rounded-xl text-violet-600 dark:text-violet-400">
            <ListChecks className="size-6" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100">
              {t('generation.outlineEditor.title')}
            </h3>
            <p className="text-sm text-muted-foreground">
              {t('generation.outlineEditor.desc')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground tabular-nums">
            {t('generation.outlineEditor.sceneCount', { count: outlines.length })}
            {totalDuration > 0 && (
              <>
                {' · '}
                {t('generation.outlineEditor.estDuration', {
                  minutes: Math.max(1, Math.round(totalDuration / 60)),
                })}
              </>
            )}
          </span>
        </div>
      </div>

      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto custom-scrollbar pr-3 space-y-3 pb-3">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={outlines.map((o) => o.id)}
            strategy={verticalListSortingStrategy}
          >
            <AnimatePresence initial={false}>
              {outlines.map((outline, idx) => (
                <SortableOutlineCard
                  key={outline.id}
                  outline={outline}
                  index={idx}
                  busy={busy}
                  isRegenerating={busy === 'one' && regeneratingId === outline.id}
                  onChange={(patch) => updateOutline(outline.id, patch)}
                  onTypeChangeRequest={handleTypeChangeRequest}
                  onDelete={() => removeOutline(outline.id)}
                  onRegenerate={(feedback) => onRegenerateOne(outline.id, feedback)}
                />
              ))}
            </AnimatePresence>
          </SortableContext>
        </DndContext>

        {/* Add new scene */}
        <div className="pt-2 flex justify-center">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2 border-dashed"
                disabled={busy !== 'none'}
              >
                <Plus className="size-4" />
                {t('generation.outlineEditor.addScene')}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="center" className="w-44 p-1">
              {SCENE_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => addOutline(type)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-muted transition-colors"
                >
                  <span
                    className={cn(
                      'inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide',
                      SCENE_TYPE_COLORS[type],
                    )}
                  >
                    {t(`generation.outlineEditor.type.${type}`)}
                  </span>
                </button>
              ))}
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Validation / status */}
      {(!validation.ok || errorMessage) && (
        <div className="mt-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 text-xs text-amber-800 dark:text-amber-200 space-y-1">
          {errorMessage && <p className="font-medium">{errorMessage}</p>}
          {validation.issues.map((issue, i) => (
            <p key={i}>{t(issue.key, issue.params)}</p>
          ))}
        </div>
      )}

      {/* Footer action bar */}
      <div className="mt-4 pt-4 border-t border-violet-100/60 dark:border-violet-900/30 flex items-center justify-between gap-3 flex-wrap">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-2"
          onClick={() => {
            setRegenAllFeedback('');
            setRegenAllOpen(true);
          }}
          disabled={busy !== 'none' || outlines.length === 0}
        >
          {busy === 'all' ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCcw className="size-4" />
          )}
          {t('generation.outlineEditor.regenerateAll')}
        </Button>

        <Button
          type="button"
          size="sm"
          className="gap-2 bg-violet-600 hover:bg-violet-700 text-white"
          onClick={onConfirm}
          disabled={!canConfirm}
        >
          <CheckCircle2 className="size-4" />
          {t('generation.outlineEditor.confirmAndContinue')}
        </Button>
      </div>

      {/* Regenerate-all dialog */}
      <Dialog open={regenAllOpen} onOpenChange={setRegenAllOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('generation.outlineEditor.regenerateAllTitle')}</DialogTitle>
            <DialogDescription>
              {t('generation.outlineEditor.regenerateAllDesc')}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={regenAllFeedback}
            onChange={(e) => setRegenAllFeedback(e.target.value)}
            placeholder={t('generation.outlineEditor.feedbackPlaceholder')}
            rows={5}
            className="resize-none"
          />
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setRegenAllOpen(false)}
              disabled={busy !== 'none'}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              className="bg-violet-600 hover:bg-violet-700 text-white"
              onClick={() => {
                setRegenAllOpen(false);
                onRegenerateAll(regenAllFeedback);
              }}
              disabled={busy !== 'none'}
            >
              <RefreshCcw className="size-4 mr-2" />
              {t('generation.outlineEditor.regenerateAllConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Type change confirmation */}
      <AlertDialog
        open={pendingTypeChange !== null}
        onOpenChange={(open) => {
          if (!open) setPendingTypeChange(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('generation.outlineEditor.changeTypeTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('generation.outlineEditor.changeTypeWarning')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmTypeChange}>
              {t('common.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Per-scene card ──────────────────────────────────────────

interface SortableOutlineCardProps {
  outline: SceneOutline;
  index: number;
  busy: 'none' | 'all' | 'one';
  isRegenerating: boolean;
  onChange: (patch: Partial<SceneOutline>) => void;
  onTypeChangeRequest: (id: string, nextType: SceneType) => void;
  onDelete: () => void;
  onRegenerate: (feedback: string) => void;
}

function SortableOutlineCard({
  outline,
  index,
  busy,
  isRegenerating,
  onChange,
  onTypeChangeRequest,
  onDelete,
  onRegenerate,
}: SortableOutlineCardProps) {
  const { t } = useI18n();
  const dragDisabled = busy !== 'none';
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: outline.id,
    disabled: dragDisabled,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : undefined,
  };

  const [regenOpen, setRegenOpen] = useState(false);
  const [regenFeedback, setRegenFeedback] = useState('');

  const updateKeyPoint = (idx: number, value: string) => {
    const next = [...(outline.keyPoints || [])];
    next[idx] = value;
    onChange({ keyPoints: next });
  };

  const removeKeyPoint = (idx: number) => {
    const next = [...(outline.keyPoints || [])];
    next.splice(idx, 1);
    onChange({ keyPoints: next.length > 0 ? next : [''] });
  };

  const addKeyPoint = () => {
    onChange({ keyPoints: [...(outline.keyPoints || []), ''] });
  };

  return (
    <motion.div
      ref={setNodeRef}
      style={style}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.2 }}
      className={cn(
        'rounded-xl border bg-white/85 dark:bg-slate-800/85 backdrop-blur-sm shadow-sm hover:shadow-md transition-shadow',
        isDragging
          ? 'border-violet-300 dark:border-violet-700 ring-2 ring-violet-300/40'
          : 'border-slate-200 dark:border-slate-700',
        isRegenerating && 'animate-pulse',
      )}
    >
      <div className="flex items-stretch">
        {/* Drag handle + index */}
        <div
          className={cn(
            'flex flex-col items-center justify-start gap-1 px-2 pt-3 pb-2 border-r border-slate-100 dark:border-slate-700/70 select-none',
            dragDisabled ? 'cursor-not-allowed opacity-40' : 'cursor-grab active:cursor-grabbing',
          )}
          {...(dragDisabled ? {} : attributes)}
          {...(dragDisabled ? {} : listeners)}
        >
          <span className="text-[10px] font-black w-5 h-5 rounded-full flex items-center justify-center shrink-0 bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 tabular-nums">
            {index + 1}
          </span>
          <GripVertical className="size-3.5 text-slate-300 dark:text-slate-600" />
        </div>

        {/* Body */}
        <div className="flex-1 p-3 space-y-2.5 min-w-0">
          {/* Top row: type + actions */}
          <div className="flex items-center justify-between gap-2">
            <Select
              value={outline.type}
              onValueChange={(v) => onTypeChangeRequest(outline.id, v as SceneType)}
              disabled={busy !== 'none'}
            >
              <SelectTrigger
                className={cn(
                  'h-7 w-32 text-[11px] font-semibold uppercase tracking-wide border-none px-2',
                  SCENE_TYPE_COLORS[outline.type],
                )}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCENE_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {t(`generation.outlineEditor.type.${type}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex items-center gap-1">
              <Popover
                open={regenOpen}
                onOpenChange={(open) => {
                  setRegenOpen(open);
                  if (open) setRegenFeedback('');
                }}
              >
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 gap-1 text-xs"
                    disabled={busy !== 'none'}
                  >
                    {isRegenerating ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <RefreshCcw className="size-3.5" />
                    )}
                    {t('generation.outlineEditor.regenerateOne')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-72 space-y-2">
                  <div className="text-xs font-semibold flex items-center gap-1.5 text-slate-700 dark:text-slate-200">
                    <Pencil className="size-3.5" />
                    {t('generation.outlineEditor.regenerateOneTitle')}
                  </div>
                  <Textarea
                    value={regenFeedback}
                    onChange={(e) => setRegenFeedback(e.target.value)}
                    placeholder={t('generation.outlineEditor.feedbackPlaceholder')}
                    rows={4}
                    className="resize-none text-xs"
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setRegenOpen(false)}
                    >
                      {t('common.cancel')}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className="bg-violet-600 hover:bg-violet-700 text-white"
                      onClick={() => {
                        setRegenOpen(false);
                        onRegenerate(regenFeedback);
                      }}
                    >
                      {t('generation.outlineEditor.regenerateOneConfirm')}
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-rose-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30"
                onClick={onDelete}
                disabled={busy !== 'none'}
                aria-label={t('generation.outlineEditor.deleteScene')}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </div>

          {/* Title */}
          <Input
            value={outline.title}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder={t('generation.outlineEditor.titlePlaceholder')}
            className="h-9 text-base font-bold"
            disabled={busy !== 'none'}
          />

          {/* Description */}
          <Textarea
            value={outline.description || ''}
            onChange={(e) => onChange({ description: e.target.value })}
            placeholder={t('generation.outlineEditor.descPlaceholder')}
            rows={2}
            className="resize-none text-sm leading-relaxed"
            disabled={busy !== 'none'}
          />

          {/* Key points */}
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t('generation.outlineEditor.keyPoints')}
            </p>
            <div className="space-y-1.5">
              {(outline.keyPoints || []).map((kp, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span className="text-violet-500 text-base leading-none w-4 shrink-0 text-center">
                    •
                  </span>
                  <Input
                    value={kp}
                    onChange={(e) => updateKeyPoint(i, e.target.value)}
                    placeholder={t('generation.outlineEditor.keyPointPlaceholder')}
                    className="h-8 text-sm"
                    disabled={busy !== 'none'}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-rose-500"
                    onClick={() => removeKeyPoint(i)}
                    disabled={busy !== 'none'}
                    aria-label={t('generation.outlineEditor.removeKeyPoint')}
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={addKeyPoint}
                disabled={busy !== 'none'}
              >
                <Plus className="size-3.5" />
                {t('generation.outlineEditor.addKeyPoint')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Validation ──────────────────────────────────────────────

interface ValidationIssue {
  key: string;
  params?: Record<string, string | number>;
}

function validateOutlines(outlines: SceneOutline[]): {
  ok: boolean;
  issues: ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];
  if (outlines.length === 0) {
    issues.push({ key: 'generation.outlineEditor.validation.empty' });
  }
  outlines.forEach((o, i) => {
    if (!o.title.trim()) {
      issues.push({
        key: 'generation.outlineEditor.validation.missingTitle',
        params: { index: i + 1 },
      });
    }
    const validKeyPoints = (o.keyPoints || []).filter((k) => k.trim());
    if (validKeyPoints.length === 0) {
      issues.push({
        key: 'generation.outlineEditor.validation.missingKeyPoints',
        params: { index: i + 1 },
      });
    }
  });
  return { ok: issues.length === 0, issues };
}
