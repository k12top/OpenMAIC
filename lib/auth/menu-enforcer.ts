/**
 * MenuSnapshot — the cached `(userId → menu permissions)` map that the
 * client and server consult instead of round-tripping to Casdoor on every
 * UI render or API request.
 *
 * Lifecycle:
 *   1. Built lazily on first access via {@link getMenuSnapshot}.
 *   2. Cached in-memory keyed by userId for `MENU_PERMISSIONS_TTL_MS`
 *      (default 30 minutes).
 *   3. Invalidated explicitly by {@link invalidateMenuSnapshot} — the
 *      `/api/auth/refresh-permissions` endpoint and (future) Casdoor
 *      webhooks call this so admin-side policy changes don't require the
 *      user to log out.
 *
 * Two source modes are supported:
 *   - `casdoor` — RBAC opt-in via `CASDOOR_RBAC_ENABLED=true`. We batch
 *     every (menu × op) pair into a single Casdoor `/api/batch-enforce`
 *     call.
 *   - `env-fallback` — translate the legacy `OPENMAIC_ROLE_PERMISSIONS`
 *     env mapping to the new menu vocabulary. Existing self-host deploys
 *     keep working with zero changes.
 *
 * If Casdoor is the configured source but the call fails, we fall back to
 * the env mode rather than locking everyone out — better to be permissive
 * than to brick the whole UI when the policy server is down. A warning is
 * logged so operators can react.
 */

import { createLogger } from '@/lib/logger';
import {
  MENUS,
  MENU_OPS,
  type MenuOp,
} from './menu-registry';
import {
  ACTIONS,
  isRbacConfigured,
  parseRolePermissionsEnv,
  resolvePermissions,
  type Action,
} from './permissions';
import {
  batchEnforce,
  EnforcerUnavailableError,
  type CasbinRequest,
} from './casdoor-enforcer';
import type { AuthUser } from '@/lib/server/auth-guard';

const log = createLogger('menu-enforcer');

export interface MenuPermBits {
  visible: boolean;
  operable: boolean;
}

export type MenuMap = Record<string, MenuPermBits>;

export interface MenuSnapshot {
  byMenu: MenuMap;
  generatedAt: number;
  source: 'casdoor' | 'env-fallback' | 'permissive';
}

const DEFAULT_TTL_MS = 30 * 60 * 1000;

function ttlMs(): number {
  const raw = process.env.MENU_PERMISSIONS_TTL_MS;
  if (!raw) return DEFAULT_TTL_MS;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TTL_MS;
}

function rbacEnabled(): boolean {
  const raw = (process.env.CASDOOR_RBAC_ENABLED ?? '').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}

function permissionDomain(): string {
  return process.env.CASDOOR_PERMISSION_DOMAIN || process.env.CASDOOR_ORG_NAME || 'built-in';
}

// ─── Cache ──────────────────────────────────────────────────────────────

interface CacheEntry {
  snapshot: MenuSnapshot;
  expiresAt: number;
}

/**
 * Module-level cache. In a single-process Next.js dev server this is a
 * plain Map; in production with multiple workers each worker maintains
 * its own cache (acceptable: snapshots only differ within their TTL, and
 * the refresh endpoint clears all workers via the same mechanism on any
 * stickied request).
 */
const cache = new Map<string, CacheEntry>();

export function invalidateMenuSnapshot(userId: string): void {
  cache.delete(userId);
}

/** Drop every cached snapshot — used by the broad "refresh all" admin path. */
export function clearMenuSnapshotCache(): void {
  cache.clear();
}

// ─── Public entry point ────────────────────────────────────────────────

/**
 * Resolve the user's effective menu permission snapshot, building (and
 * caching) it on first access. Always returns — never throws — by falling
 * back to the env mapping if the Casdoor call blows up.
 */
export async function getMenuSnapshot(user: AuthUser): Promise<MenuSnapshot> {
  const cached = cache.get(user.id);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.snapshot;
  }

  const fresh = await buildMenuSnapshot(user, cached?.snapshot);
  cache.set(user.id, {
    snapshot: fresh,
    expiresAt: now + ttlMs(),
  });
  return fresh;
}

/** Build a fresh snapshot, choosing source based on env. */
async function buildMenuSnapshot(
  user: AuthUser,
  staleFallback?: MenuSnapshot,
): Promise<MenuSnapshot> {
  if (rbacEnabled()) {
    try {
      return await buildFromCasdoor(user);
    } catch (err) {
      if (err instanceof EnforcerUnavailableError) {
        log.warn(
          'Casdoor enforce unavailable; falling back to ' +
            (staleFallback ? 'stale snapshot' : 'env mapping'),
          err,
        );
      } else {
        log.warn('Casdoor enforce failed unexpectedly', err);
      }
      // Prefer a stale-but-real snapshot over reverting to env entirely.
      if (staleFallback) {
        return { ...staleFallback, generatedAt: Date.now() };
      }
      return buildFromEnvFallback(user);
    }
  }
  return buildFromEnvFallback(user);
}

// ─── Casdoor source ────────────────────────────────────────────────────

async function buildFromCasdoor(user: AuthUser): Promise<MenuSnapshot> {
  const dom = permissionDomain();
  // One enforce request per (menu × op). Order matters — we rely on the
  // returned boolean[] sharing the same indexing.
  const reqs: CasbinRequest[] = [];
  const keys: Array<{ menuId: string; op: MenuOp }> = [];
  for (const menu of MENUS) {
    for (const op of MENU_OPS) {
      reqs.push([user.id, dom, menu.id, op]);
      keys.push({ menuId: menu.id, op });
    }
  }

  const results = await batchEnforce(reqs);

  const byMenu: MenuMap = {};
  for (let i = 0; i < keys.length; i++) {
    const { menuId, op } = keys[i];
    const allow = results[i] === true;
    const bits = byMenu[menuId] ?? { visible: false, operable: false };
    bits[op] = allow;
    byMenu[menuId] = bits;
  }
  // Implicit rule: anything that is `operable` is also `visible` — saves
  // admins from having to set both flags for every grant.
  for (const id of Object.keys(byMenu)) {
    if (byMenu[id].operable) byMenu[id].visible = true;
  }

  return {
    byMenu,
    generatedAt: Date.now(),
    source: 'casdoor',
  };
}

// ─── Env fallback source ───────────────────────────────────────────────

/**
 * Translate the existing `Action` vocabulary into menu_id permissions so
 * deploys upgrading from the action-only world keep working without
 * touching policy. Owner-bypass is intentionally NOT applied here; it is
 * the caller's responsibility (see `useMenuPerm` / `requireMenuPerm`).
 */
const ACTION_TO_MENU_OPS: Record<Action, Array<{ menuId: string; op: MenuOp }>> = {
  regenerate: [{ menuId: 'toolbar.regenerate', op: 'operable' }],
  'edit-source': [
    { menuId: 'toolbar.editSource', op: 'operable' },
    { menuId: 'toolbar.lectureMode', op: 'operable' },
  ],
  reorder: [{ menuId: 'sidebar.reorderScenes', op: 'operable' }],
  'delete-scene': [{ menuId: 'sidebar.deleteScene', op: 'operable' }],
  'add-scene': [{ menuId: 'sidebar.addScene', op: 'operable' }],
  share: [
    { menuId: 'header.share', op: 'operable' },
    { menuId: 'header.sync', op: 'operable' },
  ],
  'delete-classroom': [{ menuId: 'home.deleteClassroom', op: 'operable' }],
};

function buildFromEnvFallback(user: AuthUser): MenuSnapshot {
  const rbacEnv = process.env.OPENMAIC_ROLE_PERMISSIONS;
  const byMenu: MenuMap = {};

  // Step 1 — start every menu at "default policy" depending on whether
  // the deploy has opted into RBAC at all.
  const permissive = !isRbacConfigured(rbacEnv);
  for (const menu of MENUS) {
    byMenu[menu.id] = {
      visible: permissive,
      operable: permissive,
    };
  }

  if (permissive) {
    return {
      byMenu,
      generatedAt: Date.now(),
      source: 'permissive',
    };
  }

  // Step 2 — apply the env-derived action grants on top of the deny-by-
  // default base. `resolvePermissions` already unions across roles.
  const actions = resolvePermissions(user.roles, parseRolePermissionsEnv(rbacEnv));
  for (const act of actions) {
    const grants = ACTION_TO_MENU_OPS[act];
    if (!grants) continue;
    for (const { menuId, op } of grants) {
      const bits = byMenu[menuId] ?? { visible: false, operable: false };
      bits[op] = true;
      // Operable implies visible.
      if (op === 'operable') bits.visible = true;
      byMenu[menuId] = bits;
    }
  }

  // Step 3 — menu_ids that the legacy action model never gated (routes,
  // settings sections, generate / rename / sync / export entry points)
  // stay visible+operable for any authenticated user. Otherwise upgrading
  // to the menu vocabulary would silently revoke features that the
  // existing `OPENMAIC_ROLE_PERMISSIONS` grammar had no way to address.
  // Strict deny for every menu is the Casdoor mode, not env-fallback.
  const ALWAYS_ON_FALLBACK = new Set<string>([
    // Anything that wasn't covered by the legacy action vocabulary.
    'home.generate',
    'home.renameClassroom',
    'header.sync',
    'header.export',
    'toolbar.lectureMode',
  ]);
  for (const menu of MENUS) {
    if (
      menu.id.startsWith('route.') ||
      menu.id.startsWith('settings.') ||
      ALWAYS_ON_FALLBACK.has(menu.id)
    ) {
      byMenu[menu.id] = { visible: true, operable: true };
    }
  }

  // Step 4 — `delete-classroom` only flips on if explicitly granted by
  // `OPENMAIC_ROLE_PERMISSIONS`; preserved by the action loop above. No
  // extra work needed here.

  // ── DEBUG ──
  log.debug(
    `env-fallback snapshot for ${user.id}: roles=[${user.roles.join(',')}], grants=${Object.entries(byMenu)
      .filter(([, b]) => b.visible || b.operable)
      .map(([id, b]) => `${id}(${b.visible ? 'V' : '-'}${b.operable ? 'O' : '-'})`)
      .join(',')}`,
  );

  return {
    byMenu,
    generatedAt: Date.now(),
    source: 'env-fallback',
  };
}

// ─── Pure helpers (used by client/server gates) ────────────────────────

/**
 * Pure decision function — does the snapshot allow `op` on `menuId`?
 * Unknown menus default to `false` in strict (Casdoor) mode and `true`
 * in fully-permissive mode (no RBAC env at all). Owner-bypass logic is
 * applied by the caller, not here.
 */
export function isMenuAllowed(
  snapshot: MenuSnapshot | null | undefined,
  menuId: string,
  op: MenuOp = 'visible',
): boolean {
  if (!snapshot) return false;
  const bits = snapshot.byMenu[menuId];
  if (bits) return !!bits[op];
  // Unknown menu_id — be permissive only when the snapshot itself was
  // built in permissive mode (no RBAC opted in). RBAC mode = strict deny.
  return snapshot.source === 'permissive';
}

// Re-export for downstream consumers that don't want to depend directly
// on the registry / actions modules.
export { ACTIONS, type Action };
