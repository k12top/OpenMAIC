'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, ChevronRight, Eraser, History, Minimize2, PencilLine, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { WhiteboardCanvas } from './whiteboard-canvas';
import type { WhiteboardCanvasHandle } from './whiteboard-canvas';
import { WhiteboardHistory } from './whiteboard-history';
import { useStageStore } from '@/lib/store';
import { useCanvasStore } from '@/lib/store/canvas';
import { useWhiteboardHistoryStore } from '@/lib/store/whiteboard-history';
import { createStageAPI } from '@/lib/api/stage-api';
import { toast } from 'sonner';
import { useI18n } from '@/lib/hooks/use-i18n';

interface WhiteboardProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

/**
 * Whiteboard component
 */
export function Whiteboard({ isOpen, onClose }: WhiteboardProps) {
  const { t } = useI18n();
  const stage = useStageStore.use.stage();
  const isClearing = useCanvasStore.use.whiteboardClearing();
  const clearingRef = useRef(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [railExpanded, setRailExpanded] = useState(true);
  const [viewModified, setViewModified] = useState(false);
  const canvasRef = useRef<WhiteboardCanvasHandle>(null);
  const snapshotCount = useWhiteboardHistoryStore((s) => s.snapshots.length);

  // Get element count for indicator
  const whiteboard = stage?.whiteboard?.[0];
  const elementCount = whiteboard?.elements?.length || 0;

  const stageAPI = createStageAPI(useStageStore);

  useEffect(() => {
    if (!isOpen) {
      setRailExpanded(true);
      setHistoryOpen(false);
    }
  }, [isOpen]);

  const collapseRail = () => {
    setHistoryOpen(false);
    setRailExpanded(false);
  };

  const handleClear = async () => {
    if (!whiteboard || elementCount === 0 || clearingRef.current) return;
    clearingRef.current = true;

    // Save snapshot before clearing
    if (whiteboard.elements && whiteboard.elements.length > 0) {
      useWhiteboardHistoryStore.getState().pushSnapshot(whiteboard.elements);
    }

    // Trigger cascade exit animation
    useCanvasStore.getState().setWhiteboardClearing(true);

    // Wait for cascade: base 380ms + 55ms per element, capped at 1400ms
    const animMs = Math.min(380 + elementCount * 55, 1400);
    await new Promise((resolve) => setTimeout(resolve, animMs));

    // Actually remove elements
    const result = stageAPI.whiteboard.delete(whiteboard.id);
    useCanvasStore.getState().setWhiteboardClearing(false);
    clearingRef.current = false;

    if (result.success) {
      toast.success(t('whiteboard.clearSuccess'));
    } else {
      toast.error(t('whiteboard.clearError') + result.error);
    }
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-[110]">
      {/* Single surface: grid + card + canvas + rail (no extra nesting for layout only) */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 30 }}
            animate={{
              opacity: 1,
              scale: 1,
              y: 0,
              transition: {
                type: 'spring',
                stiffness: 120,
                damping: 18,
                mass: 1.2,
              },
            }}
            exit={{
              opacity: 0,
              scale: 0.95,
              y: 16,
              transition: { duration: 0.5, ease: [0.4, 0, 0.2, 1] },
            }}
            className="pointer-events-auto absolute inset-3 z-[120] flex flex-col overflow-hidden rounded-2xl bg-white [background-image:radial-gradient(#d1d5db_1px,transparent_1px)] shadow-[0_24px_64px_-24px_rgba(0,0,0,0.35)] ring-1 ring-black/[0.06] [background-size:20px_20px] dark:bg-gray-950 dark:[background-image:radial-gradient(#4b5563_1px,transparent_1px)] dark:ring-white/[0.08]"
          >
            <WhiteboardCanvas
              ref={canvasRef}
              className="min-h-0 flex-1"
              onViewModifiedChange={setViewModified}
            />

            <div
              className={cn(
                'pointer-events-none absolute z-[125] flex flex-col items-end',
                railExpanded ? 'right-3 top-1/2 -translate-y-1/2' : 'bottom-20 right-3',
              )}
            >
              <AnimatePresence mode="wait" initial={false}>
                {railExpanded ? (
                  <motion.div
                    key="rail"
                    role="toolbar"
                    aria-label={t('whiteboard.title')}
                    initial={{ opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 12 }}
                    transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
                    className="pointer-events-auto flex w-fit flex-col items-center gap-0.5 rounded-xl border border-gray-200/90 bg-white/90 px-1.5 py-1.5 shadow-lg backdrop-blur-md dark:border-gray-600/80 dark:bg-gray-900/90"
                  >
                    <div className="flex items-center gap-0.5 border-b border-gray-200/80 pb-1.5 dark:border-gray-600/80">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-100">
                        <PencilLine className="h-3.5 w-3.5" aria-hidden />
                      </div>
                      <button
                        type="button"
                        onClick={collapseRail}
                        className="shrink-0 rounded-md p-0.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
                        title={t('whiteboard.collapseToolbar')}
                      >
                        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </div>

                    <AnimatePresence>
                      {viewModified && (
                        <motion.button
                          type="button"
                          initial={{ opacity: 0, scale: 0.85 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.85 }}
                          transition={{ duration: 0.15 }}
                          onClick={() => canvasRef.current?.resetView()}
                          whileTap={{ scale: 0.92 }}
                          className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
                          title={t('whiteboard.resetView')}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </motion.button>
                      )}
                    </AnimatePresence>

                    <motion.button
                      type="button"
                      onClick={handleClear}
                      disabled={isClearing || elementCount === 0}
                      whileTap={{ scale: 0.92 }}
                      className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:pointer-events-none disabled:opacity-40 dark:text-gray-400 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                      title={t('whiteboard.clear')}
                    >
                      <motion.div
                        animate={isClearing ? { rotate: [0, -15, 15, -10, 10, 0] } : { rotate: 0 }}
                        transition={
                          isClearing ? { duration: 0.5, ease: 'easeInOut' } : { duration: 0.2 }
                        }
                      >
                        <Eraser className="h-3.5 w-3.5" />
                      </motion.div>
                    </motion.button>

                    <div className="relative">
                      <motion.button
                        type="button"
                        onClick={() => setHistoryOpen(!historyOpen)}
                        whileTap={{ scale: 0.92 }}
                        className="relative rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
                        title={t('whiteboard.history')}
                      >
                        <History className="h-3.5 w-3.5" />
                        {snapshotCount > 0 && (
                          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-gray-800 px-1 text-[10px] font-bold text-white dark:bg-gray-200 dark:text-gray-900">
                            {snapshotCount}
                          </span>
                        )}
                      </motion.button>
                      <WhiteboardHistory isOpen={historyOpen} onClose={() => setHistoryOpen(false)} />
                    </div>

                    <div className="mx-auto h-px w-6 bg-gray-200 dark:bg-gray-600" />

                    <button
                      type="button"
                      onClick={onClose}
                      className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
                      title={t('whiteboard.minimize')}
                    >
                      <Minimize2 className="h-3.5 w-3.5" />
                    </button>
                  </motion.div>
                ) : (
                  <motion.button
                    key="rail-collapsed"
                    type="button"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
                    onClick={() => setRailExpanded(true)}
                    whileTap={{ scale: 0.94 }}
                    className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full border border-gray-200/90 bg-white/95 shadow-lg backdrop-blur-md dark:border-gray-600/80 dark:bg-gray-900/95"
                    title={t('whiteboard.expandToolbar')}
                  >
                    <ChevronLeft className="h-5 w-5 text-gray-700 dark:text-gray-200" aria-hidden />
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
