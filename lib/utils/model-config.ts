import { PROVIDERS } from '@/lib/ai/providers';
import { useSettingsStore } from '@/lib/store/settings';

/**
 * Get current model configuration from settings store
 */
export function getCurrentModelConfig() {
  const { providerId, modelId, providersConfig } = useSettingsStore.getState();
  const catalog = PROVIDERS[providerId];
  const resolvedModelId =
    modelId?.trim() || catalog?.models[0]?.id || PROVIDERS.openai.models[0]?.id || 'gpt-4o-mini';
  const modelString = `${providerId}:${resolvedModelId}`;

  // Get current provider's config
  const providerConfig = providersConfig[providerId];

  return {
    providerId,
    modelId: resolvedModelId,
    modelString,
    apiKey: providerConfig?.apiKey || '',
    baseUrl: providerConfig?.baseUrl || '',
    providerType: providerConfig?.type,
    requiresApiKey: providerConfig?.requiresApiKey,
    isServerConfigured: providerConfig?.isServerConfigured,
  };
}
