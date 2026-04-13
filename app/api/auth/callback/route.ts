import { NextResponse } from 'next/server';
import { casdoorSDK, casdoorConfig } from '@/lib/auth/casdoor';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!code) {
    return NextResponse.json({ error: 'No code provided' }, { status: 400 });
  }

  try {
    const token = await casdoorSDK.getAuthToken(code);
    const user = casdoorSDK.parseJwtToken(token.access_token);

    // Default redirect to home
    let redirectUrl = url.origin;
    
    // Check if we have a valid returnUrl in state
    if (state && state !== casdoorConfig.appName) {
      try {
        const decodedState = decodeURIComponent(state);
        // Security: only redirect to internal paths or same origin
        if (decodedState.startsWith('/') || decodedState.startsWith(url.origin)) {
          redirectUrl = decodedState;
        }
      } catch (err) {
        console.error('Failed to parse returnUrl from state:', err);
      }
    }

    const response = NextResponse.redirect(redirectUrl);
    
    // In a real production app, consider encrypting this or using a session store.
    // For minimal integration, we store the raw JWT or a simplified payload for the client to read.
    response.cookies.set('casdoor_token', token.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7, // 1 week
    });

    return response;
  } catch (error) {
    console.error('Casdoor authentication error:', error);
    return NextResponse.redirect(`${url.origin}/?error=auth_failed`);
  }
}
