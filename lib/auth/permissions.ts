/**
 * Lightweight role-based permission system for OpenMAIC.
 *
 * Permissions are coarse-grained "actions" the UI can gate. Owners of a
 * resource implicitly get all `owner-range` actions — the permission map
 * is only consulted for non-owner viewers and for the special
 * `delete-classroom` action which always requires explicit permission.
 *
 * The role → permission map is configured via `OPENMAIC_ROLE_PERMISSIONS`
 * env var using a simple textual format:
 *
 *   admin:*|teacher:regenerate,edit-source,reorder,delete-scene,share|student:
 *
 * - `*` grants every known action.
 * - Empty permission list = role is recognized but grants nothing.
 * - Unknown roles are ignored silently.
 */

/** All actions the UI may gate on. Keep in sync with frontend `<Can action=...>`. */
export const ACTIONS = [
  'regenerate',
  'edit-source',
  'reorder',
  'delete-scene',
  'add-scene',
  'share',
  'delete-classroom',
] as const;

export type Action = (typeof ACTIONS)[number];

/** Subset of actions an *owner* implicitly has — these never require RBAC. */
export const OWNER_IMPLICIT_ACTIONS: readonly Action[] = [
  'regenerate',
  'edit-source',
  'reorder',
  'delete-scene',
  'add-scene',
  'share',
];

/**
 * Parse the `OPENMAIC_ROLE_PERMISSIONS` env string into a role→actions map.
 * Returns an empty map on missing/invalid input.
 *
 * Note: "RBAC unconfigured" vs "RBAC explicitly empty" is disambiguated by
 * {@link isRbacConfigured}. When unconfigured, the deploy is in the legacy
 * permissive mode where every authenticated user has every action —
 * {@link resolvePermissions} relies on this distinction via its callers.
 */
export function parseRolePermissionsEnv(raw: string | undefined | null): Record<string, Action[]> {
  if (!raw) return {};
  const result: Record<string, Action[]> = {};
  for (const chunk of raw.split('|')) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(':');
    if (colon === -1) continue;
    const role = trimmed.slice(0, colon).trim();
    const actionsStr = trimmed.slice(colon + 1).trim();
    if (!role) continue;
    if (actionsStr === '*') {
      result[role] = [...ACTIONS];
      continue;
    }
    const parsed = actionsStr
      .split(',')
      .map((a) => a.trim())
      .filter((a): a is Action => (ACTIONS as readonly string[]).includes(a));
    result[role] = parsed;
  }
  return result;
}

/**
 * Resolve a user's effective permission set from their roles, using the
 * provided role-permissions map. Union semantics across roles.
 */
export function resolvePermissions(
  roles: readonly string[],
  rolePerms: Record<string, Action[]>,
): Action[] {
  const set = new Set<Action>();
  for (const role of roles) {
    const perms = rolePerms[role];
    if (!perms) continue;
    for (const p of perms) set.add(p);
  }
  return Array.from(set);
}

/** Check whether a permission set includes a given action. */
export function hasPermission(perms: readonly Action[], action: Action): boolean {
  return perms.includes(action);
}

/**
 * Whether RBAC is configured at all for this deploy. When false, the
 * backend grants every action to every authenticated user (legacy /
 * migration-friendly default). Set `OPENMAIC_ROLE_PERMISSIONS` to enable
 * strict mode.
 */
export function isRbacConfigured(raw: string | undefined | null): boolean {
  return !!raw && raw.trim().length > 0;
}

