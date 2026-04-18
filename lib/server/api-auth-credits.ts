import { NextResponse } from 'next/server';
import { requireAuth, UnauthenticatedError } from './auth-guard';
import type { AuthUser } from './auth-guard';
import { checkCredits, consumeCredits, InsufficientCreditsError } from './credits';
import { isDbConfigured } from '@/lib/db';

export { type AuthUser } from './auth-guard';

/**
 * Run auth + credit check before an API handler.
 * Returns the user if authorized and has credits; otherwise returns an error Response.
 */
export async function withAuthAndCredits(): Promise<
  | { ok: true; user: AuthUser }
  | { ok: false; response: NextResponse }
> {
  try {
    const user = await requireAuth();

    if (isDbConfigured()) {
      try {
        await checkCredits(user.id);
      } catch (err) {
        if (err instanceof InsufficientCreditsError) {
          return {
            ok: false,
            response: NextResponse.json(
              {
                error: 'Insufficient credits',
                code: 'INSUFFICIENT_CREDITS',
                balance: err.balance,
              },
              { status: 402 },
            ),
          };
        }
        throw err;
      }
    }

    return { ok: true, user };
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: err.message, code: 'UNAUTHENTICATED' },
          { status: 401 },
        ),
      };
    }
    throw err;
  }
}

/**
 * Record credit consumption after a successful AI call.
 */
export async function recordUsage(
  userId: string,
  opts: Parameters<typeof consumeCredits>[1],
) {
  await consumeCredits(userId, opts);
}
