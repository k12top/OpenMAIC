/**
 * Reconstruct a minimal `SceneOutline` from an existing `Scene`.
 *
 * Outlines are normally produced by Stage 1 of the generation pipeline and
 * persisted to IndexedDB only — they are NOT stored on the server. When a
 * user opens a classroom on a fresh browser, a different device, or after
 * clearing site data, `useStageStore.outlines` ends up empty even though
 * `scenes` is fully populated from the server. The regenerate-current-page
 * flow needs an outline to drive the LLM call (and to render the dialog),
 * so we synthesize a best-effort one from the scene.
 *
 * The reconstructed outline is intentionally minimal:
 *  - `description` and `keyPoints` are left empty so the user supplies them
 *    in the dialog's "simple" / "advanced" modes.
 *  - `mediaGenerations` is derived from image / video elements on the slide
 *    canvas so the regenerate flow knows which canvas slots to refill.
 *  - The id is deterministically derived from the scene id so repeated
 *    reconstructions produce stable identifiers.
 */
import type { Scene, SlideContent } from '@/lib/types/stage';
import type { SceneOutline } from '@/lib/types/generation';
import type { MediaGenerationRequest } from '@/lib/media/types';
import type { PPTElement } from '@/lib/types/slides';

const RECONSTRUCTED_OUTLINE_ID_PREFIX = 'reconstructed-';

export function isReconstructedOutlineId(id: string | undefined): boolean {
  return !!id && id.startsWith(RECONSTRUCTED_OUTLINE_ID_PREFIX);
}

function extractMediaGenerations(scene: Scene): MediaGenerationRequest[] {
  if (scene.type !== 'slide') return [];
  const slideContent = scene.content as SlideContent | undefined;
  const elements: PPTElement[] = slideContent?.canvas?.elements ?? [];
  const out: MediaGenerationRequest[] = [];
  for (const el of elements) {
    if (el.type === 'image' || el.type === 'video') {
      // Only include AI-generated placeholder slots (gen_img_*, gen_vid_*).
      // Real user-uploaded media should not be re-prompted on regen.
      if (!el.id) continue;
      if (!/^gen_(img|vid)_/.test(el.id)) continue;
      out.push({
        type: el.type,
        elementId: el.id,
        prompt: '',
      });
    }
  }
  return out;
}

export function reconstructOutlineFromScene(scene: Scene): SceneOutline {
  const mediaGenerations = extractMediaGenerations(scene);
  return {
    id: `${RECONSTRUCTED_OUTLINE_ID_PREFIX}${scene.id}`,
    type: scene.type,
    title: scene.title || '',
    description: '',
    keyPoints: [],
    order: scene.order,
    ...(mediaGenerations.length > 0 ? { mediaGenerations } : {}),
  };
}
