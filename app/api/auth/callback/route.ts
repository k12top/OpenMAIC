import { NextResponse } from 'next/server';
import { casdoorSDK, casdoorConfig, getPublicAppOrigin } from '@/lib/auth/casdoor';
import { isDbConfigured, getDb, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const publicOrigin = getPublicAppOrigin(request);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  // Diagnostic: log inbound shape so we can correlate with /api/auth/me
  // failures. We log the *presence* of the code (not its value) to avoid
  // leaking single-use credentials into shared log aggregators.
  console.info('[auth/callback] enter', {
    origin: publicOrigin,
    hasCode: !!code,
    state: state || null,
  });

  // Helper: build an auth-failure redirect that ALSO clears the SSO probe
  // marker. Without this, middleware would believe the browser already
  // failed an SSO probe and never auto-bounce the user to login again,
  // leaving them stuck unauthenticated.
  const failRedirect = (reason: string) => {
    const target = `${publicOrigin}/?error=auth_failed&reason=${encodeURIComponent(reason)}`;
    const res = NextResponse.redirect(target);
    res.cookies.delete('sso_probed');
    console.info('[auth/callback] fail', { reason });
    return res;
  };

  if (!code) {
    return failRedirect('missing_code');
  }

  try {
    const token = await casdoorSDK.getAuthToken(code);
    const casdoorUser = casdoorSDK.parseJwtToken(token.access_token);

    // Sync user to PostgreSQL on login
    if (isDbConfigured()) {
      try {
        await syncUserOnLogin(casdoorUser);
      } catch (err) {
        console.error('Failed to sync user to DB:', err);
      }
    }

    let redirectUrl = publicOrigin;

    if (state && state !== casdoorConfig.appName) {
      try {
        const decodedState = decodeURIComponent(state);
        if (decodedState.startsWith('/')) {
          // Relative path — must be made absolute for NextResponse.redirect()
          redirectUrl = `${publicOrigin}${decodedState}`;
        } else if (decodedState.startsWith(publicOrigin)) {
          redirectUrl = decodedState;
        }
      } catch (err) {
        console.error('Failed to parse returnUrl from state:', err);
      }
    }

    const response = NextResponse.redirect(redirectUrl);

    response.cookies.set('casdoor_token', token.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    });

    // Clear the SSO probe marker so future cross-site probes work correctly
    response.cookies.delete('sso_probed');

    // `casdoorUser` is loosely-typed across Casdoor versions: id is canonical
    // but some installs return only `name` / `sub`. Cast through `any` to
    // tolerate both shapes without forcing the SDK type.
    const u = casdoorUser as any;
    const issuedUserId = (u && (u.id || u.name || u.sub)) || '<unknown>';
    console.info('[auth/callback] ok', {
      user: issuedUserId,
      redirectUrl,
      tokenLen: token.access_token?.length ?? 0,
    });

    return response;
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'token_exchange_failed';
    console.error('Casdoor authentication error:', error);
    return failRedirect(reason || 'token_exchange_failed');
  }
}

async function syncUserOnLogin(casdoorUser: any) {
  const db = getDb();
  const userId = casdoorUser.id || casdoorUser.name || casdoorUser.sub || '';
  if (!userId) return;

  const existing = await db.query.users.findFirst({
    where: eq(schema.users.id, userId),
  });

  if (!existing) {
    await db.insert(schema.users).values({
      id: userId,
      casdoorName: casdoorUser.name || '',
      nickname: casdoorUser.displayName || casdoorUser.name || '',
      avatar: casdoorUser.avatar || '',
      email: casdoorUser.email || '',
    });
    const initialCredits = parseInt(process.env.INITIAL_CREDITS || '100', 10);
    await db.insert(schema.credits).values({
      userId,
      balance: initialCredits,
      totalEarned: initialCredits,
    });
    await db.insert(schema.creditTransactions).values({
      userId,
      amount: initialCredits,
      type: 'grant',
      description: 'Welcome bonus',
    });
  }
}
