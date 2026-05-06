import { cookies } from 'next/headers';
import { casdoorSDK } from '@/lib/auth/casdoor';
import { isDbConfigured, getDb, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';
import {
  ACTIONS,
  isRbacConfigured,
  parseRolePermissionsEnv,
  resolvePermissions,
  type Action,
} from '@/lib/auth/permissions';
import { createLogger } from '@/lib/logger';

const log = createLogger('auth-guard');

export interface AuthUser {
  id: string;
  name: string;
  nickname: string;
  avatar: string;
  email: string;
  /** Raw roles extracted from Casdoor JWT (union of `roles` / `groups` / `tag`). */
  roles: string[];
  /** Effective permissions derived from roles via `OPENMAIC_ROLE_PERMISSIONS`. */
  permissions: Action[];
}

/**
 * Extract roles from a parsed Casdoor JWT. Casdoor deployments vary in
 * where they surface role info; we accept all three common variants:
 *
 *  - `roles: string[]` (recent Casdoor builds)
 *  - `groups: string[]` (older builds / some identity providers)
 *  - `tag: string` (a single role label — Casdoor's default user field)
 */
function extractRoles(parsed: Record<string, unknown>): string[] {
  const out = new Set<string>();
  const rawRoles = parsed.roles;
  if (Array.isArray(rawRoles)) {
    for (const r of rawRoles) {
      if (typeof r === 'string' && r) out.add(r);
      // Casdoor sometimes returns role objects `{ name, owner }`
      else if (r && typeof r === 'object' && 'name' in r && typeof r.name === 'string') {
        out.add(r.name);
      }
    }
  }
  const rawGroups = parsed.groups;
  if (Array.isArray(rawGroups)) {
    for (const g of rawGroups) {
      if (typeof g === 'string' && g) out.add(g);
    }
  }
  const tag = parsed.tag;
  if (typeof tag === 'string' && tag) out.add(tag);
  return Array.from(out);
}

export class UnauthenticatedError extends Error {
  constructor(message = 'Authentication required') {
    super(message);
    this.name = 'UnauthenticatedError';
  }
}

/**
 * Extract the authenticated user from the request cookie.
 * Syncs the user to the local database on first encounter.
 * Throws UnauthenticatedError if no valid token is present.
 */
export async function requireAuth(): Promise<AuthUser> {
  const cookieStore = await cookies();
  const token = cookieStore.get('casdoor_token')?.value;

  if (!token) {
    // Debug, not warn — most 401s are simply unauthenticated visitors
    // (incognito, devtools probes like /.well-known/...). Bumping these
    // to warn would make logs unreadable. Use LOG_LEVEL=debug to see them.
    log.debug('401 reason=no-cookie (casdoor_token absent)');
    throw new UnauthenticatedError();
  }

  type CasdoorJwtUser = ReturnType<typeof casdoorSDK.parseJwtToken> & {
    /** Standard JWT subject (Casdoor User type may omit this) */
    sub?: string;
  };

  let parsed: CasdoorJwtUser;
  try {
    parsed = casdoorSDK.parseJwtToken(token) as CasdoorJwtUser;
  } catch (err) {
    log.info(`401 reason=invalid-or-expired-token err=${(err as Error).message}`);
    throw new UnauthenticatedError('Invalid or expired token');
  }

  const roles = extractRoles(parsed as unknown as Record<string, unknown>);
  const rbacEnv = process.env.OPENMAIC_ROLE_PERMISSIONS;
  // When RBAC is unconfigured, every authenticated user has every action
  // (legacy / migration default). Once the deploy opts in by setting
  // OPENMAIC_ROLE_PERMISSIONS, permissions derive strictly from roles.
  const permissions: Action[] = isRbacConfigured(rbacEnv)
    ? resolvePermissions(roles, parseRolePermissionsEnv(rbacEnv))
    : [...ACTIONS];

  const user: AuthUser = {
    id: String(parsed.id ?? parsed.name ?? parsed.sub ?? ''),
    name: String(parsed.name ?? ''),
    nickname: String(parsed.displayName ?? parsed.name ?? ''),
    avatar: String(parsed.avatar ?? ''),
    email: String(parsed.email ?? ''),
    roles,
    permissions,
  };

  if (!user.id) {
    log.warn('401 reason=token-missing-user-identity');
    throw new UnauthenticatedError('Token missing user identity');
  }

  // Sync to local DB (best-effort, non-blocking for the caller)
  if (isDbConfigured()) {
    try {
      await syncUserToDb(user);
    } catch {
      // Don't block auth on DB errors
    }
  }

  return user;
}

/**
 * Optional auth: returns user or null (never throws).
 */
export async function optionalAuth(): Promise<AuthUser | null> {
  try {
    return await requireAuth();
  } catch {
    return null;
  }
}

async function syncUserToDb(user: AuthUser) {
  const db = getDb();
  const existing = await db.query.users.findFirst({
    where: eq(schema.users.id, user.id),
  });

  if (!existing) {
    await db.insert(schema.users).values({
      id: user.id,
      casdoorName: user.name,
      nickname: user.nickname,
      avatar: user.avatar,
      email: user.email,
    });
    // Also create initial credits for new user
    const initialCredits = parseInt(process.env.INITIAL_CREDITS || '10000', 10);
    await db.insert(schema.credits).values({
      userId: user.id,
      balance: initialCredits,
      totalEarned: initialCredits,
    });
    await db.insert(schema.creditTransactions).values({
      userId: user.id,
      amount: initialCredits,
      type: 'grant',
      description: 'Welcome bonus',
    });
  } else {
    // Update profile if changed
    if (
      existing.nickname !== user.nickname ||
      existing.avatar !== user.avatar ||
      existing.email !== user.email
    ) {
      await db
        .update(schema.users)
        .set({
          nickname: user.nickname,
          avatar: user.avatar,
          email: user.email,
          updatedAt: new Date(),
        })
        .where(eq(schema.users.id, user.id));
    }

    // Ensure credits row exists (may be missing if DB was unavailable at first login)
    const creditsRow = await db.query.credits.findFirst({
      where: eq(schema.credits.userId, user.id),
    });
    if (!creditsRow) {
      const initialCredits = parseInt(process.env.INITIAL_CREDITS || '10000', 10);
      await db.insert(schema.credits).values({
        userId: user.id,
        balance: initialCredits,
        totalEarned: initialCredits,
      });
      await db.insert(schema.creditTransactions).values({
        userId: user.id,
        amount: initialCredits,
        type: 'grant',
        description: 'Welcome bonus (retroactive)',
      });
    }
  }
}
