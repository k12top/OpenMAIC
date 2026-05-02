/**
 * Effective Agent Name Resolver
 *
 * Single source of truth that maps a stable `agentId` to the display name
 * the user currently wants to see and inject into prompts. The product
 * supports renaming AI agents from three places (classroom, generation
 * preview, settings) plus an i18n localized default. Rather than hard-code
 * any of those layers into individual call sites, every consumer (UI label,
 * prompt builder, exporter, etc.) goes through {@link resolveAgentName}.
 *
 * Resolution priority (highest → lowest):
 *  1. `stage.agentNameOverrides[agentId]` — per-classroom override
 *  2. `stage.generatedAgentConfigs[].name` — per-classroom generated name
 *  3. `settings.agentNamePresets[agentId]` — global preset override
 *  4. `t(`settings.agentNames.${agentId}`)` — i18n localized default
 *  5. The base `name` (registry / generated / passed-in fallback)
 *
 * The helpers are pure, side-effect free, and runnable on both client and
 * server. Pass `null` for any layer you don't have available — the
 * resolver will simply skip it.
 */

import type { Stage } from '@/lib/types/stage';
import type { AgentInfo } from '@/lib/generation/pipeline-types';

export interface NameResolveContext {
  /** Per-classroom override map (highest priority). */
  stageOverrides?: Stage['agentNameOverrides'] | null;
  /** Per-classroom generated configs (second-highest priority). */
  generatedConfigs?: Stage['generatedAgentConfigs'] | null;
  /** Global per-user preset override map (third priority). */
  settingsPresets?: Record<string, string> | null;
  /**
   * Optional i18n translator. When provided, used to look up
   * `settings.agentNames.<agentId>`. We treat the missing-translation
   * marker (i18next echoes the key back) as "no localized name".
   */
  t?: ((key: string) => string) | null;
}

/**
 * Trim and reject empty / whitespace-only strings, returning `undefined`
 * so the resolver naturally falls through to the next priority layer.
 */
function clean(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Resolve the effective display name for an agent.
 *
 * @param agentId  Stable agent identifier (e.g. `'default-1'` or `'gen-xxx'`).
 * @param baseName Fallback name (typically the registry/generated `agent.name`).
 *                 Used when no override / preset / i18n translation matches.
 * @param ctx      Optional sources to consult; missing fields are skipped.
 */
export function resolveAgentName(
  agentId: string,
  baseName: string | undefined,
  ctx: NameResolveContext = {},
): string {
  if (!agentId) return clean(baseName) ?? '';

  // 1. Per-classroom override
  const stageOverride = clean(ctx.stageOverrides?.[agentId]);
  if (stageOverride) return stageOverride;

  // 2. Per-classroom generated config name
  if (ctx.generatedConfigs && ctx.generatedConfigs.length > 0) {
    const generated = ctx.generatedConfigs.find((g) => g.id === agentId);
    const generatedName = clean(generated?.name);
    if (generatedName) return generatedName;
  }

  // 3. Global preset override
  const preset = clean(ctx.settingsPresets?.[agentId]);
  if (preset) return preset;

  // 4. i18n localized default — only if the translator returned a real
  //    translation (i18next echoes the key when missing).
  if (ctx.t) {
    const key = `settings.agentNames.${agentId}`;
    const translated = ctx.t(key);
    if (translated && translated !== key) {
      const cleaned = clean(translated);
      if (cleaned) return cleaned;
    }
  }

  // 5. Bare fallback
  return clean(baseName) ?? agentId;
}

/**
 * Clone an array of {@link AgentInfo} with each `name` replaced by the
 * effective name from {@link resolveAgentName}. Used by client call sites
 * before sending agent rosters to `/api/generate/*` and similar prompt
 * pipelines, so the server sees the user-chosen names without needing
 * any awareness of the override layers.
 *
 * Returns a new array; the input is not mutated. Empty/undefined input
 * yields an empty array so callers can safely chain.
 */
export function applyEffectiveNames<T extends AgentInfo>(
  agents: readonly T[] | undefined | null,
  ctx: NameResolveContext = {},
): T[] {
  if (!agents || agents.length === 0) return [];
  return agents.map((a) => ({
    ...a,
    name: resolveAgentName(a.id, a.name, ctx),
  }));
}
