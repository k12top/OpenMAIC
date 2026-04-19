import { cookies } from 'next/headers';
import { casdoorSDK } from '@/lib/auth/casdoor';
import { isDbConfigured, getDb, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';

export interface AuthUser {
  id: string;
  name: string;
  nickname: string;
  avatar: string;
  email: string;
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
    throw new UnauthenticatedError();
  }

  type CasdoorJwtUser = ReturnType<typeof casdoorSDK.parseJwtToken> & {
    /** Standard JWT subject (Casdoor User type may omit this) */
    sub?: string;
  };

  let parsed: CasdoorJwtUser;
  try {
    parsed = casdoorSDK.parseJwtToken(token) as CasdoorJwtUser;
  } catch {
    throw new UnauthenticatedError('Invalid or expired token');
  }

  const user: AuthUser = {
    id: String(parsed.id ?? parsed.name ?? parsed.sub ?? ''),
    name: String(parsed.name ?? ''),
    nickname: String(parsed.displayName ?? parsed.name ?? ''),
    avatar: String(parsed.avatar ?? ''),
    email: String(parsed.email ?? ''),
  };

  if (!user.id) {
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
