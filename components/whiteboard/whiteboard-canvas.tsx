'use client';

import {
  useRef,
  useState,
  useEffect,
  useCallback,
  useMemo,
  forwardRef,
  useImperativeHandle,
} from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useStageStore } from '@/lib/store';
import { useCanvasStore } from '@/lib/store/canvas';
import { ScreenElement } from '@/components/slide-renderer/Editor/ScreenElement';
import type { PPTElement } from '@/lib/types/slides';
import { useI18n } from '@/lib/hooks/use-i18n';
import { cn } from '@/lib/utils';

export type WhiteboardCanvasHandle = {
  resetView: () => void;
};

function AnimatedElement({
  element,
  index,
  isClearing,
  totalElements,
}: {
  element: PPTElement;
  index: number;
  isClearing: boolean;
  totalElements: number;
}) {
  const clearDelay = isClearing ? (totalElements - 1 - index) * 0.055 : 0;
  const clearRotate = isClearing ? (index % 2 === 0 ? 1 : -1) * (2 + index * 0.4) : 0;

  return (
    <motion.div
      layout={false}
      initial={{ opacity: 0, scale: 0.92, y: 8, filter: 'blur(4px)' }}
      animate={
        isClearing
          ? {
              opacity: 0,
              scale: 0.35,
              y: -35,
              rotate: clearRotate,
              filter: 'blur(8px)',
              transition: {
                duration: 0.38,
                delay: clearDelay,
                ease: [0.5, 0, 1, 0.6],
              },
            }
          : {
              opacity: 1,
              scale: 1,
              y: 0,
              rotate: 0,
              filter: 'blur(0px)',
              transition: {
                duration: 0.45,
                ease: [0.16, 1, 0.3, 1],
                delay: index * 0.05,
              },
            }
      }
      exit={{
        opacity: 0,
        scale: 0.85,
        transition: { duration: 0.2 },
      }}
      className="absolute inset-0"
      style={{ pointerEvents: isClearing ? 'none' : undefined }}
    >
      <div style={{ pointerEvents: 'auto' }}>
        <ScreenElement elementInfo={element} elementIndex={index} animate />
      </div>
    </motion.div>
  );
}

const CANVAS_W = 1000;
const CANVAS_H = 562.5;

export type WhiteboardCanvasProps = {
  onViewModifiedChange?: (modified: boolean) => void;
  className?: string;
};

/**
 * Pan/zoom whiteboard: one root node (resize + input + clipped viewport).
 */
export const WhiteboardCanvas = forwardRef<WhiteboardCanvasHandle, WhiteboardCanvasProps>(
  function WhiteboardCanvas({ onViewModifiedChange, className }, ref) {
    const { t } = useI18n();
    const stage = useStageStore.use.stage();
    const isClearing = useCanvasStore.use.whiteboardClearing();
    const rootRef = useRef<HTMLDivElement>(null);
    const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

    const whiteboard = stage?.whiteboard?.[0];
    const rawElements = whiteboard?.elements;
    const elements = useMemo(() => rawElements ?? [], [rawElements]);

    const containerScale = useMemo(() => {
      if (containerSize.width === 0 || containerSize.height === 0) return 1;
      return Math.min(containerSize.width / CANVAS_W, containerSize.height / CANVAS_H);
    }, [containerSize.width, containerSize.height]);

    const [viewZoom, setViewZoom] = useState(1);
    const [panX, setPanX] = useState(0);
    const [panY, setPanY] = useState(0);
    const [isPanning, setIsPanning] = useState(false);
    const [isResetting, setIsResetting] = useState(false);
    const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
    const prevElementsLengthRef = useRef(elements.length);
    const resetTimerRef = useRef<number | null>(null);

    const containerWidth = containerSize.width;
    const containerHeight = containerSize.height;

    const isViewModified = viewZoom !== 1 || panX !== 0 || panY !== 0;

    const clampPan = useCallback(
      (x: number, y: number, zoom: number) => {
        const totalScale = containerScale * zoom;
        const maxPanX = CANVAS_W / 2 + containerWidth / (2 * totalScale);
        const maxPanY = CANVAS_H / 2 + containerHeight / (2 * totalScale);
        return {
          x: Math.max(-maxPanX, Math.min(maxPanX, x)),
          y: Math.max(-maxPanY, Math.min(maxPanY, y)),
        };
      },
      [containerScale, containerWidth, containerHeight],
    );

    const resetView = useCallback((animate: boolean) => {
      setIsPanning(false);
      setIsResetting(animate);
      setViewZoom(1);
      setPanX(0);
      setPanY(0);

      if (resetTimerRef.current) {
        window.clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }

      if (!animate) {
        return;
      }

      resetTimerRef.current = window.setTimeout(() => {
        setIsResetting(false);
        resetTimerRef.current = null;
      }, 250);
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        resetView: () => resetView(true),
      }),
      [resetView],
    );

    useEffect(() => {
      onViewModifiedChange?.(isViewModified);
    }, [isViewModified, onViewModifiedChange]);

    useEffect(() => {
      const el = rootRef.current;
      if (!el) {
        return;
      }

      const observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (entry) {
          setContainerSize({
            width: entry.contentRect.width,
            height: entry.contentRect.height,
          });
        }
      });
      observer.observe(el);
      setContainerSize({ width: el.clientWidth, height: el.clientHeight });

      return () => observer.disconnect();
    }, []);

    const handlePointerDown = useCallback(
      (e: React.PointerEvent) => {
        if (e.button !== 0) {
          return;
        }

        e.preventDefault();
        setIsPanning(true);
        panStartRef.current = { x: e.clientX, y: e.clientY, panX, panY };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      },
      [panX, panY],
    );

    const handlePointerMove = useCallback(
      (e: React.PointerEvent) => {
        if (!isPanning) {
          return;
        }

        const dx = e.clientX - panStartRef.current.x;
        const dy = e.clientY - panStartRef.current.y;
        const effectiveScale = Math.max(containerScale * viewZoom, 0.001);

        const newPanX = panStartRef.current.panX + dx / effectiveScale;
        const newPanY = panStartRef.current.panY + dy / effectiveScale;
        const clamped = clampPan(newPanX, newPanY, viewZoom);
        setPanX(clamped.x);
        setPanY(clamped.y);
      },
      [containerScale, viewZoom, isPanning, clampPan],
    );

    const handlePointerUp = useCallback((e: React.PointerEvent) => {
      if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      }

      setIsPanning(false);
    }, []);

    useEffect(() => {
      const el = rootRef.current;
      if (!el) {
        return;
      }

      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        if (elements.length === 0) {
          return;
        }

        const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;

        setViewZoom((prevZoom) => {
          const newZoom = Math.min(5, Math.max(0.2, prevZoom * zoomFactor));

          const rect = el.getBoundingClientRect();
          const cursorX = e.clientX - rect.left;
          const cursorY = e.clientY - rect.top;

          const oldScale = containerScale * prevZoom;
          const newScale = containerScale * newZoom;
          const scaleDiff = 1 / newScale - 1 / oldScale;

          setPanX((prevPanX) => {
            const newPanX = prevPanX + (cursorX - containerWidth / 2) * scaleDiff;
            const maxPX = CANVAS_W / 2 + containerWidth / (2 * newScale);
            return Math.max(-maxPX, Math.min(maxPX, newPanX));
          });

          setPanY((prevPanY) => {
            const newPanY = prevPanY + (cursorY - containerHeight / 2) * scaleDiff;
            const maxPY = CANVAS_H / 2 + containerHeight / (2 * newScale);
            return Math.max(-maxPY, Math.min(maxPY, newPanY));
          });

          return newZoom;
        });
      };

      el.addEventListener('wheel', onWheel, { passive: false });
      return () => el.removeEventListener('wheel', onWheel);
    }, [elements.length, containerScale, containerWidth, containerHeight]);

    useEffect(() => {
      return () => {
        if (resetTimerRef.current) {
          window.clearTimeout(resetTimerRef.current);
        }
      };
    }, []);

    useEffect(() => {
      const prevLength = prevElementsLengthRef.current;
      const nextLength = elements.length;
      prevElementsLengthRef.current = nextLength;

      const clearedBoard = prevLength > 0 && nextLength === 0;
      const firstContentLoaded = prevLength === 0 && nextLength > 0;
      if (!clearedBoard && !firstContentLoaded) {
        return;
      }

      let cancelled = false;
      queueMicrotask(() => {
        if (!cancelled) {
          resetView(false);
        }
      });

      return () => {
        cancelled = true;
      };
    }, [elements.length, resetView]);

    const handleDoubleClick = useCallback(
      (e?: React.MouseEvent) => {
        e?.preventDefault();
        resetView(true);
      },
      [resetView],
    );

    const totalScale = containerScale * viewZoom;
    const canvasScreenX = (containerWidth - CANVAS_W * totalScale) / 2 + panX * totalScale;
    const canvasScreenY = (containerHeight - CANVAS_H * totalScale) / 2 + panY * totalScale;
    const canvasTransform = `translate(${canvasScreenX}px, ${canvasScreenY}px) scale(${totalScale})`;

    return (
      <div
        ref={rootRef}
        className={cn('relative h-full w-full overflow-hidden select-none', className)}
        style={{
          cursor: isPanning ? 'grabbing' : 'grab',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={handleDoubleClick}
      >
        <div
          className="absolute rounded-lg border border-gray-200 bg-white shadow-2xl dark:border-gray-600"
          style={{
            width: CANVAS_W,
            height: CANVAS_H,
            left: 0,
            top: 0,
            transform: canvasTransform,
            transformOrigin: '0 0',
            transition: isResetting ? 'transform 0.25s ease-out' : undefined,
          }}
        >
          <div className="absolute inset-0">
            <AnimatePresence>
              {elements.length === 0 && !isClearing && (
                <motion.div
                  key="placeholder"
                  initial={{ opacity: 0 }}
                  animate={{
                    opacity: 1,
                    transition: { delay: 0.25, duration: 0.4 },
                  }}
                  exit={{ opacity: 0, transition: { duration: 0.15 } }}
                  className="absolute inset-0 flex items-center justify-center"
                >
                  <div className="text-center text-gray-400">
                    <p className="text-lg font-medium">{t('whiteboard.ready')}</p>
                    <p className="mt-1 text-sm">{t('whiteboard.readyHint')}</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence mode="popLayout">
              {elements.map((element, index) => (
                <AnimatedElement
                  key={element.id}
                  element={element}
                  index={index}
                  isClearing={isClearing}
                  totalElements={elements.length}
                />
              ))}
            </AnimatePresence>
          </div>
        </div>
      </div>
    );
  },
);
