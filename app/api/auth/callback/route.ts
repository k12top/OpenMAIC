import { NextResponse } from 'next/server';
import { casdoorSDK, casdoorConfig, getPublicAppOrigin } from '@/lib/auth/casdoor';
import { isDbConfigured, getDb, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const publicOrigin = getPublicAppOrigin(request);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!code) {
    return NextResponse.json({ error: 'No code provided' }, { status: 400 });
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

    return response;
  } catch (error) {
    console.error('Casdoor authentication error:', error);
    return NextResponse.redirect(`${publicOrigin}/?error=auth_failed`);
  }
}

async function syncUserOnLogin(casdoorUser: Record<string, string>) {
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
