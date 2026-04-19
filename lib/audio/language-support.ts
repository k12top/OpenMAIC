/**
 * Language matching for TTS and ASR providers.
 *
 * Given a target language (BCP-47), find the best voice/language from
 * the provider's supported list, with graceful fallback to English.
 */

import { TTS_PROVIDERS, ASR_PROVIDERS } from './constants';
import type { TTSProviderId, ASRProviderId } from './types';

/**
 * Extract the primary language subtag from a BCP-47 tag.
 * e.g. 'zh-CN' -> 'zh', 'en-US' -> 'en', 'ja-JP' -> 'ja'
 */
function primaryLang(tag: string): string {
  return tag.split('-')[0].toLowerCase();
}

/**
 * Find the best TTS voice for a given language from the provider's voice list.
 *
 * Match priority:
 * 1. Exact match (e.g. 'zh-CN' === voice.language)
 * 2. Primary language match (e.g. 'zh' for 'zh-TW')
 * 3. Fallback to 'en' voice
 * 4. First available voice
 */
export function findBestTTSVoice(
  targetLanguage: string,
  providerId: TTSProviderId,
): { voiceId: string; matched: boolean } | null {
  const provider = TTS_PROVIDERS[providerId];
  if (!provider?.voices?.length) return null;

  const targetPrimary = primaryLang(targetLanguage);

  // Exact match
  const exact = provider.voices.find(
    (v) => v.language?.toLowerCase() === targetLanguage.toLowerCase(),
  );
  if (exact) return { voiceId: exact.id, matched: true };

  // Primary language match
  const primary = provider.voices.find(
    (v) => v.language && primaryLang(v.language) === targetPrimary,
  );
  if (primary) return { voiceId: primary.id, matched: true };

  // Fallback to English
  const enVoice = provider.voices.find(
    (v) => v.language && primaryLang(v.language) === 'en',
  );
  if (enVoice) return { voiceId: enVoice.id, matched: false };

  // Last resort: first voice
  return { voiceId: provider.voices[0].id, matched: false };
}

/**
 * Check if an ASR provider supports a given language.
 * Returns the best matching language code, or 'en' as fallback.
 */
export function findBestASRLanguage(
  targetLanguage: string,
  providerId: ASRProviderId,
): { language: string; matched: boolean } {
  const provider = ASR_PROVIDERS[providerId];
  if (!provider?.supportedLanguages?.length) {
    return { language: 'en', matched: false };
  }

  const targetPrimary = primaryLang(targetLanguage);
  const langs = provider.supportedLanguages;

  // Exact match (BCP-47 or provider-specific tag)
  const exact = langs.find((l) => l.toLowerCase() === targetLanguage.toLowerCase());
  if (exact) return { language: exact, matched: true };

  // Primary subtag match (e.g. zh-CN → zh, or en-US → en)
  const primary = langs.find((l) => primaryLang(l) === targetPrimary);
  if (primary) return { language: primary, matched: true };

  // Auto detection if supported
  const auto = langs.find((l) => l.toLowerCase() === 'auto');
  if (auto) return { language: 'auto', matched: true };

  // Fallback to English
  const en = langs.find((l) => primaryLang(l) === 'en');
  if (en) return { language: en, matched: false };

  return { language: langs[0], matched: false };
}

/**
 * Get the display name for a BCP-47 language tag.
 */
const LANGUAGE_NAMES: Record<string, string> = {
  'zh-CN': '中文 (简体)',
  'zh-TW': '中文 (繁體)',
  'en-US': 'English (US)',
  'en-GB': 'English (UK)',
  'ja-JP': '日本語',
  'ko-KR': '한국어',
  'fr-FR': 'Français',
  'de-DE': 'Deutsch',
  'es-ES': 'Español',
  'pt-BR': 'Português (BR)',
  'ru-RU': 'Русский',
  'ar-SA': 'العربية',
};

export function getLanguageDisplayName(tag: string): string {
  return LANGUAGE_NAMES[tag] || tag;
}
