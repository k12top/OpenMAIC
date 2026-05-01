/**
 * Shared TTS utilities used by both client-side and server-side generation.
 */

import type { TTSProviderId } from './types';
import type { Action, SpeechAction } from '@/lib/types/action';
import { createLogger } from '@/lib/logger';

const log = createLogger('TTS');

/** Provider-specific max text length limits. */
export const TTS_MAX_TEXT_LENGTH: Partial<Record<TTSProviderId, number>> = {
  'glm-tts': 1024,
};

/**
 * Split long text into chunks that respect sentence boundaries.
 * Tries splitting at sentence-ending punctuation first, then clause-level
 * punctuation, and finally hard-splits at maxLength as a last resort.
 */
export function splitLongSpeechText(text: string, maxLength: number): string[] {
  const normalized = text.trim();
  if (!normalized || normalized.length <= maxLength) return [normalized];

  const units = normalized
    .split(/(?<=[。！？!?；;：:\n])/u)
    .map((part) => part.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = '';

  const pushChunk = (value: string) => {
    const trimmed = value.trim();
    if (trimmed) chunks.push(trimmed);
  };

  const appendUnit = (unit: string) => {
    if (!current) {
      current = unit;
      return;
    }
    if ((current + unit).length <= maxLength) {
      current += unit;
      return;
    }
    pushChunk(current);
    current = unit;
  };

  const hardSplitUnit = (unit: string) => {
    const parts = unit.split(/(?<=[，,、])/u).filter(Boolean);
    if (parts.length > 1) {
      for (const part of parts) {
        if (part.length <= maxLength) appendUnit(part);
        else hardSplitUnit(part);
      }
      return;
    }

    let start = 0;
    while (start < unit.length) {
      appendUnit(unit.slice(start, start + maxLength));
      start += maxLength;
    }
  };

  for (const unit of units.length > 0 ? units : [normalized]) {
    if (unit.length <= maxLength) appendUnit(unit);
    else hardSplitUnit(unit);
  }

  pushChunk(current);
  return chunks;
}

/**
 * Split long speech actions into multiple shorter actions so each stays
 * within the TTS provider's text length limit. Each sub-action gets its
 * own independent audio file — no byte concatenation needed.
 */
export function splitLongSpeechActions(actions: Action[], providerId: TTSProviderId): Action[] {
  const maxLength = TTS_MAX_TEXT_LENGTH[providerId];
  if (!maxLength) return actions;

  let didSplit = false;
  const nextActions: Action[] = actions.flatMap((action) => {
    if (action.type !== 'speech' || !action.text || action.text.length <= maxLength)
      return [action];

    const chunks = splitLongSpeechText(action.text, maxLength);
    if (chunks.length <= 1) return [action];
    didSplit = true;
    const { audioId: _audioId, ...baseAction } = action as SpeechAction;

    log.info(
      `Split speech for ${providerId}: action=${action.id}, len=${action.text.length}, chunks=${chunks.length}`,
    );
    return chunks.map((chunk, i) => ({
      ...baseAction,
      id: `${action.id}_tts_${i + 1}`,
      text: chunk,
    }));
  });
  return didSplit ? nextActions : actions;
}

// ─── Stale-audio detection ───────────────────────────────────────────────

/**
 * Compute a fast, deterministic hash of the speech text. Used to mark
 * generated audio as "fresh" so the UI can detect when text was edited
 * after the audio was synthesized. Not crypto — fnv1a-32 is plenty.
 *
 * Returns a hex string. Case-sensitive on purpose; punctuation and
 * whitespace are normalized so trivially-equivalent edits don't trigger
 * a false stale flag.
 */
export function hashSpeechText(text: string): string {
  const normalized = (text || '').replace(/\s+/g, ' ').trim();
  let hash = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i);
    // Multiply by FNV prime (mod 2^32 via Math.imul tricks)
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Whether a speech action's audio is stale relative to its current text.
 * Returns false when no audio has been generated (nothing to be stale)
 * or when the action has no `audioTextHash` (legacy data — treated as
 * fresh until the user explicitly regenerates).
 */
export function isSpeechAudioStale(action: SpeechAction): boolean {
  if (!action.text) return false;
  const hasAudio = !!action.audioId || !!action.audioUrl;
  if (!hasAudio) return false;
  if (!action.audioTextHash) return false;
  return action.audioTextHash !== hashSpeechText(action.text);
}

