'use client';

import Canvas from './Canvas';
import type { StageMode } from '@/lib/types/stage';
import { ScreenCanvas } from './ScreenCanvas';

/**
 * Slide Editor - wraps Canvas with SceneProvider
 */
export function SlideEditor({ mode, isPreview = false }: { readonly mode: StageMode; readonly isPreview?: boolean }) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-hidden">
        {mode === 'autonomous' ? <Canvas /> : <ScreenCanvas isPreview={isPreview} />}
      </div>
    </div>
  );
}
