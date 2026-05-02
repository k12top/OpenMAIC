import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { optionalAuth } from '@/lib/server/auth-guard';
import { getMenuSnapshot } from '@/lib/auth/menu-enforcer';
import { casdoorSDK } from '@/lib/auth/casdoor';
import { createLogger } from '@/lib/logger';

const log = createLogger('auth-me');

export async function GET() {
  const user = await optionalAuth();

  if (!user) {
    // /api/auth/me is the dedicated "am I logged in?" probe — always log
    // a one-line reason at info level so 401s are diagnosable without
    // bumping LOG_LEVEL=debug. We re-inspect the cookie ourselves
    // because optionalAuth() swallowed the underlying error.
    let reason = 'unknown';
    try {
      const ck = await cookies();
      const token = ck.get('casdoor_token')?.value;
      if (!token) {
        reason = 'no-cookie (casdoor_token absent)';
      } else {
        try {
          const parsed = casdoorSDK.parseJwtToken(token) as { id?: unknown; name?: unknown };
          if (!parsed?.id && !parsed?.name) {
            reason = 'token-missing-user-identity';
          } else {
            // Should not happen — optionalAuth would have returned a user.
            reason = 'token-parsed-but-rejected (db sync error?)';
          }
        } catch (err) {
          reason = `invalid-or-expired-token: ${(err as Error).message}`;
        }
      }
    } catch (err) {
      reason = `cookie-read-failed: ${(err as Error).message}`;
    }
    log.info(`401 from /api/auth/me — reason=${reason}`);
    return NextResponse.json({ authenticated: false, reason }, { status: 401 });
  }

  // Build (or read from cache) the menu permission snapshot for this user.
  // Errors here should never block /me — fall back to an empty map and let
  // the client resolve UI gates conservatively (everything hidden until
  // the user retries).
  let menus: Record<string, { visible: boolean; operable: boolean }> = {};
  let menuSource:
    | 'casdoor'
    | 'env-fallback'
    | 'permissive'
    | 'guest-fallback'
    | 'unavailable' = 'unavailable';
  try {
    const snap = await getMenuSnapshot(user);
    menus = snap.byMenu;
    menuSource = snap.source;
  } catch {
    /* keep empty map */
  }

  return NextResponse.json({
    authenticated: true,
    user: {
      id: user.id,
      nickname: user.nickname,
      avatar: user.avatar,
      email: user.email,
      roles: user.roles,
      // Legacy action-list — kept for backwards compatibility. Will be
      // removed in a future major release once all UI gates have moved
      // to the menus map below.
      permissions: user.permissions,
      // New menu permission map: { menuId: { visible, operable } }.
      menus,
      menuSource,
    },
  });
}
