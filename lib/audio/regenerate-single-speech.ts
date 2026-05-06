/**
 * Regenerate the audio for a single speech action after the user edits its
 * text. Designed to be the *only* entry point used by per-line "redo" UI so
 * the staleness flag, IndexedDB blob, MinIO upload, and player precedence
 * stay coherent.
 *
 * Why we wipe `audioUrl` first: `AudioPlayer.play` prefers `audioUrl` over
 * the IndexedDB blob, so without clearing it the player would keep using the
 * stale MinIO copy until the upload finishes. Clearing it forces a fallback
 * to the freshly-written IndexedDB blob during the gap, then `audioUrl` is
 * patched again automatically by `generateAndStoreTTS`.
 */

import { useStageStore } from '@/lib/store/stage';
import { db } from '@/lib/utils/database';
import { generateAndStoreTTS } from '@/lib/hooks/use-scene-generator';

export interface RegenerateSingleSpeechResult {
  success: boolean;
  error?: string;
}

export async function regenerateSingleSpeechAudio(
  audioId: string,
  text: string,
): Promise<RegenerateSingleSpeechResult> {
  if (!audioId) return { success: false, error: 'audioId is required' };
  if (!text || !text.trim()) return { success: false, error: 'text is empty' };

  try {
    // 1) Optimistically clear any cached cloud URL so the player falls back
    //    to the IndexedDB blob about to be re-written. Also wipe the hash
    //    so any race-condition reader sees the audio as "stale" until the
    //    new hash lands.
    useStageStore.getState().updateSpeechAction(audioId, {
      audioUrl: undefined,
      audioTextHash: undefined,
    });

    // 2) Drop the stale blob from IndexedDB. `generateAndStoreTTS` does a
    //    `put` afterwards which would overwrite anyway, but doing this
    //    delete eliminates the brief window where the old blob is still
    //    served by the player on cache hits.
    await db.audioFiles.delete(audioId).catch(() => undefined);

    // 3) Re-synthesize. This handles: API call, blob save, hash write-back,
    //    MinIO upload, and final audioUrl patch.
    await generateAndStoreTTS(audioId, text);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
