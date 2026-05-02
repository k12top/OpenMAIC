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
  source: 'casdoor' | 'env-fallback' | 'permissive' | 'guest-fallback';
}

/**
 * Read-only routes a logged-in but un-policed user should always be able
 * to *see* (no operability). Used by {@link buildGuestFallback} when
 * Casdoor is enabled but unreachable — fail-closed default rather than
 * permissively granting every menu.
 */
const GUEST_VISIBLE_MENU_IDS: readonly string[] = [
  'route.home',
  'route.classroom',
  'route.share',
  'route.credits',
];

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

/**
 * If set (and non-empty), we send 4-element `[sub, dom, obj, act]` requests
 * — the casbin "RBAC with domains" model. Leave it unset/empty to default
 * to Casdoor-friendly 3-element `[sub, obj, act]` (Casdoor's Permission UI
 * hard-codes a 3-element `[policy_definition]` validator and refuses to
 * save Permissions whose model has 4 elements).
 *
 * Single-tenant deploys should leave it OFF. Multi-tenant deploys that
 * manage policies entirely outside the Casdoor UI may opt in.
 */
function permissionDomain(): string | null {
  const raw = (process.env.CASDOOR_PERMISSION_DOMAIN ?? '').trim();
  return raw.length > 0 ? raw : null;
}

// ─── Cache ──────────────────────────────────────────────────────────────

interface CacheEntry {
  snapshot: MenuSnapshot;
  expiresAt: number;
  /**
   * Snapshot of the env knobs that influence which source we use, captured
   * at build time. If any of these change, the cached entry is treated as
   * stale and rebuilt — so toggling `CASDOOR_RBAC_ENABLED` in `.env`
   * doesn't leave users stuck on the old snapshot for the full TTL.
   */
  configFingerprint: string;
}

/**
 * Compose a fingerprint of every env var that meaningfully changes how
 * `buildMenuSnapshot` would produce its output. Cheap to recompute on
 * every cache read — just a few env lookups + string concat.
 */
function currentConfigFingerprint(): string {
  return [
    `rbac=${rbacEnabled() ? '1' : '0'}`,
    `dom=${permissionDomain() ?? ''}`,
    `enforcerName=${process.env.CASDOOR_ENFORCER_NAME ?? ''}`,
    `permName=${process.env.CASDOOR_PERMISSION_NAME ?? ''}`,
    `org=${process.env.CASDOOR_ORG_NAME ?? ''}`,
    `roleEnv=${process.env.OPENMAIC_ROLE_PERMISSIONS ?? ''}`,
  ].join('|');
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
  const fp = currentConfigFingerprint();
  if (cached && cached.expiresAt > now && cached.configFingerprint === fp) {
    return cached.snapshot;
  }
  if (cached && cached.configFingerprint !== fp) {
    log.info(
      `Config fingerprint changed for user=${user.id} — invalidating cached snapshot ` +
        `(was: ${cached.configFingerprint} | now: ${fp})`,
    );
  }

  const fresh = await buildMenuSnapshot(user, cached?.snapshot);
  cache.set(user.id, {
    snapshot: fresh,
    expiresAt: now + ttlMs(),
    configFingerprint: fp,
  });
  return fresh;
}

/** Build a fresh snapshot, choosing source based on env. */
async function buildMenuSnapshot(
  user: AuthUser,
  staleFallback?: MenuSnapshot,
): Promise<MenuSnapshot> {
  if (rbacEnabled()) {
    log.info(
      `Building snapshot for user=${user.id} via casdoor (RBAC enabled, dom=${permissionDomain() ?? '(none/3-element)'})`,
    );
    try {
      const snap = await buildFromCasdoor(user);
      const grantCount = Object.values(snap.byMenu).filter(
        (b) => b.visible || b.operable,
      ).length;
      log.info(
        `Snapshot built for user=${user.id} source=casdoor grants=${grantCount}/${Object.keys(snap.byMenu).length}`,
      );
      return snap;
    } catch (err) {
      if (err instanceof EnforcerUnavailableError) {
        log.warn(
          'Casdoor enforce unavailable; falling back to ' +
            (staleFallback ? 'stale snapshot' : 'guest minimum'),
          err,
        );
      } else {
        log.warn('Casdoor enforce failed unexpectedly', err);
      }
      // Prefer a stale-but-real snapshot over the guest minimum — the
      // user's previously-fetched policy is still the closest thing to
      // the operator's intent, even if it's a few minutes old.
      if (staleFallback) {
        return { ...staleFallback, generatedAt: Date.now() };
      }
      // FAIL-CLOSED: when RBAC is the configured authority, we MUST NOT
      // silently grant everything just because the policy server is
      // unreachable. Drop to the guest minimum (read-only on a few
      // public routes). Operators see WARN logs and can fix Casdoor /
      // re-fetch via /api/auth/refresh-permissions once it's back up.
      const fb = buildGuestFallback(user);
      log.info(
        `Snapshot built for user=${user.id} source=guest-fallback (Casdoor failed; ` +
          `${GUEST_VISIBLE_MENU_IDS.length} read-only menus exposed)`,
      );
      return fb;
    }
  }
  log.info(
    `Building snapshot for user=${user.id} via env-fallback ` +
      `(CASDOOR_RBAC_ENABLED=${process.env.CASDOOR_RBAC_ENABLED ?? '<unset>'})`,
  );
  const fb = buildFromEnvFallback(user);
  log.info(`Snapshot built for user=${user.id} source=${fb.source}`);
  return fb;
}

// ─── Casdoor source ────────────────────────────────────────────────────

/**
 * Compose the list of "subject" strings we'll try for a given user. We
 * fan out to every plausible identifier so policies can be written
 * against the user's UUID OR any of their roles, with or without the
 * `role:` prefix Casbin docs sometimes use. Casdoor decides which one
 * matches; we OR the results.
 *
 * Why fan out instead of relying on `g(user, role)` rules?
 *  - Casdoor admins commonly write `p, role:teacher, ...` policies but
 *    forget the matching `g, <user-uuid>, role:teacher` binding (which
 *    only exists if the user was added via the Roles UI). With this
 *    fan-out, the policy matches directly even without the g rule.
 *  - The cost is `(1 + roleCount) ×` request multiplication. For a
 *    typical user with 1–3 roles that's 100–200 batched requests — well
 *    within Casdoor's batch capacity.
 */
function subjectCandidates(user: AuthUser): string[] {
  const out = new Set<string>();
  if (user.id) out.add(user.id);
  for (const role of user.roles) {
    if (!role) continue;
    out.add(role); // raw, e.g. "teacher" or "k12/teacher_group"
    if (!role.startsWith('role:')) out.add(`role:${role}`); // prefixed, e.g. "role:teacher"
  }
  return Array.from(out);
}

async function buildFromCasdoor(user: AuthUser): Promise<MenuSnapshot> {
  const dom = permissionDomain();
  const subs = subjectCandidates(user);
  // Build a flat batch of (subject × menu × op) requests. We track which
  // (menu, op) each row maps to so we can OR the per-subject results.
  const reqs: CasbinRequest[] = [];
  const keys: Array<{ menuId: string; op: MenuOp; subject: string }> = [];
  for (const sub of subs) {
    for (const menu of MENUS) {
      for (const op of MENU_OPS) {
        reqs.push(
          dom === null ? [sub, menu.id, op] : [sub, dom, menu.id, op],
        );
        keys.push({ menuId: menu.id, op, subject: sub });
      }
    }
  }

  const results = await batchEnforce(reqs);

  const byMenu: MenuMap = {};
  // Track which subject won each (menu, op) for debug logging.
  const winnerBySlot = new Map<string, string>();
  for (const menu of MENUS) {
    byMenu[menu.id] = { visible: false, operable: false };
  }
  for (let i = 0; i < keys.length; i++) {
    if (results[i] !== true) continue;
    const { menuId, op, subject } = keys[i];
    byMenu[menuId][op] = true;
    const slot = `${menuId}#${op}`;
    if (!winnerBySlot.has(slot)) winnerBySlot.set(slot, subject);
  }
  // Implicit rule: anything that is `operable` is also `visible` — saves
  // admins from having to set both flags for every grant.
  for (const id of Object.keys(byMenu)) {
    if (byMenu[id].operable) byMenu[id].visible = true;
  }

  // Single high-signal debug line: subjects we tried + grants per
  // subject — answers "why didn't my policy match?" instantly.
  const grantsBySubject = new Map<string, string[]>();
  for (const [slot, subject] of winnerBySlot) {
    const arr = grantsBySubject.get(subject) ?? [];
    arr.push(slot);
    grantsBySubject.set(subject, arr);
  }
  log.debug(
    `casdoor enforce result for user=${user.id}: tried subjects=[${subs.join(', ')}] | ` +
      (grantsBySubject.size === 0
        ? 'NO subject matched any policy — check `p, <sub>, ...` rows in Casdoor'
        : Array.from(grantsBySubject.entries())
            .map(([s, slots]) => `${s} → [${slots.join(',')}]`)
            .join(' | ')),
  );

  return {
    byMenu,
    generatedAt: Date.now(),
    source: 'casdoor',
  };
}

// ─── Guest (fail-closed) fallback ─────────────────────────────────────

/**
 * Build a deny-by-default snapshot exposing only a handful of public,
 * read-only routes. Used when the operator explicitly opted into Casdoor
 * RBAC (`CASDOOR_RBAC_ENABLED=true`) but the policy server is currently
 * unreachable. We intentionally do NOT consult `OPENMAIC_ROLE_PERMISSIONS`
 * here — that would silently extend rights the operator may have already
 * removed in Casdoor. Better to under-permit and surface the outage.
 */
function buildGuestFallback(_user: AuthUser): MenuSnapshot {
  const byMenu: MenuMap = {};
  for (const menu of MENUS) {
    byMenu[menu.id] = { visible: false, operable: false };
  }
  for (const id of GUEST_VISIBLE_MENU_IDS) {
    if (byMenu[id]) {
      byMenu[id] = { visible: true, operable: false };
    }
  }
  return {
    byMenu,
    generatedAt: Date.now(),
    source: 'guest-fallback',
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
  // `add-scene` grants the parent plus every fine-grained child menu so
  // env-fallback (`OPENMAIC_ROLE_PERMISSIONS`) stays equivalent to the
  // pre-split behavior. Casdoor deploys should still list each child in
  // CSV when policies are authored explicitly.
  'add-scene': [
    { menuId: 'sidebar.addScene', op: 'operable' },
    { menuId: 'sidebar.addScene.slide', op: 'operable' },
    { menuId: 'sidebar.addScene.quiz', op: 'operable' },
    { menuId: 'sidebar.addScene.interactive', op: 'operable' },
    { menuId: 'sidebar.addScene.append', op: 'operable' },
    { menuId: 'sidebar.addScene.insert', op: 'operable' },
  ],
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
