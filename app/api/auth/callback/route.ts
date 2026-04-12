import { NextResponse } from 'next/server';
import { casdoorSDK } from '@/lib/auth/casdoor';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!code) {
    return NextResponse.json({ error: 'No code provided' }, { status: 400 });
  }

  try {
    const token = await casdoorSDK.getAuthToken(code);
    const user = casdoorSDK.verifyAuthToken(token);

    // Create a stable session cookie based on the JWT token
    const response = NextResponse.redirect(url.origin);
    
    // In a real production app, consider encrypting this or using a session store.
    // For minimal integration, we store the raw JWT or a simplified payload for the client to read.
    response.cookies.set('casdoor_token', token, {
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
