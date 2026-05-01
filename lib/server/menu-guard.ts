/**
 * Server-side menu permission guard for API routes.
 *
 * Wraps {@link requireAuth} + the cached menu snapshot built by
 * `lib/auth/menu-enforcer.ts`. Use it on any handler that performs a
 * mutation a Casdoor admin should be able to revoke per-role.
 *
 * Example:
 *   ```ts
 *   export async function POST(req: NextRequest) {
 *     const user = await requireMenuPerm('header.share', 'operable');
 *     // ...continue with the request, knowing the user is allowed.
 *   }
 *   ```
 *
 * Owner-bypass: if the menu's `ownerBypass` is not explicitly disabled
 * (`false` in the registry) AND the caller passes `isResourceOwner: true`
 * (e.g. they have already verified `classroom.userId === user.id`), the
 * request is allowed regardless of policy. This mirrors the client-side
 * `useMenuPerm` behavior so server-and-client decisions stay consistent.
 *
 * Failure modes (`ForbiddenError` is thrown):
 *  - Snapshot lookup denies the (menu, op) pair.
 *  - Casdoor is unreachable AND no stale snapshot exists AND env-fallback
 *    is not configured (the snapshot builder still produces a permissive
 *    result in that case, so this only fires when RBAC is actively
 *    configured but the policy server is down — better to fail closed
 *    than mutate without authorization).
 */

import { requireAuth, type AuthUser } from '@/lib/server/auth-guard';
import { getMenuSnapshot, isMenuAllowed } from '@/lib/auth/menu-enforcer';
import { MENUS_BY_ID, type MenuOp } from '@/lib/auth/menu-registry';
import { createLogger } from '@/lib/logger';

const log = createLogger('menu-guard');

export class ForbiddenError extends Error {
  constructor(message = 'Forbidden') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export interface RequireMenuPermContext {
  /**
   * When true, the caller has already verified the user owns the
   * resource being mutated (e.g. `classroom.userId === user.id`). For
   * menus that allow owner-bypass (default), this short-circuits the
   * policy lookup.
   */
  isResourceOwner?: boolean;
  /**
   * Optional context string included in the thrown error and log line —
   * helps tracing which resource was being acted on.
   */
  resourceId?: string;
}

/**
 * Throws if the authenticated user is not allowed to perform `op` on
 * `menuId`. Returns the resolved {@link AuthUser} on success.
 */
export async function requireMenuPerm(
  menuId: string,
  op: MenuOp = 'operable',
  ctx: RequireMenuPermContext = {},
): Promise<AuthUser> {
  const user = await requireAuth();
  await assertMenuPerm(user, menuId, op, ctx);
  return user;
}

/**
 * Same check as {@link requireMenuPerm}, but uses an already-resolved
 * {@link AuthUser}. Useful for handlers that have already called
 * {@link requireAuth} themselves (e.g. to look up resource ownership
 * before deciding whether the owner-bypass applies).
 */
export async function assertMenuPerm(
  user: AuthUser,
  menuId: string,
  op: MenuOp = 'operable',
  ctx: RequireMenuPermContext = {},
): Promise<void> {
  const meta = MENUS_BY_ID.get(menuId);
  if (!meta) {
    log.warn(`assertMenuPerm called with unregistered menuId='${menuId}'`);
  }

  // Owner-bypass: matches client-side `useMenuPerm` semantics.
  const bypassAllowed = meta?.ownerBypass !== false;
  if (bypassAllowed && ctx.isResourceOwner && op === 'operable') {
    return;
  }

  const snapshot = await getMenuSnapshot(user);
  if (isMenuAllowed(snapshot, menuId, op)) {
    return;
  }

  log.info(
    `Forbidden: user=${user.id} roles=[${user.roles.join(',')}] ` +
      `menu=${menuId} op=${op}` +
      (ctx.resourceId ? ` resource=${ctx.resourceId}` : ''),
  );
  throw new ForbiddenError(`Menu '${menuId}' op='${op}' denied`);
}

/**
 * Helper for routes that prefer to short-circuit with a `NextResponse`
 * instead of throwing. Returns either `{ ok: true, user }` or
 * `{ ok: false, response }` ready to be returned from the handler.
 */
export async function checkMenuPerm(
  menuId: string,
  op: MenuOp = 'operable',
  ctx: RequireMenuPermContext = {},
): Promise<
  | { ok: true; user: AuthUser }
  | { ok: false; status: number; error: string }
> {
  try {
    const user = await requireMenuPerm(menuId, op, ctx);
    return { ok: true, user };
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { ok: false, status: 403, error: err.message };
    }
    if ((err as Error).name === 'UnauthenticatedError') {
      return { ok: false, status: 401, error: 'Authentication required' };
    }
    throw err;
  }
}
