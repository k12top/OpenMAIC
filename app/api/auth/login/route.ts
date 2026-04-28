import { NextResponse } from 'next/server';

import { casdoorSDK, getPublicAppOrigin } from '@/lib/auth/casdoor';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const returnUrl = url.searchParams.get('returnUrl');
  const publicOrigin = getPublicAppOrigin(request);
  const redirectUri = `${publicOrigin}/api/auth/callback`;
  
  let signinUrl = casdoorSDK.getSignInUrl(redirectUri);
  
  if (returnUrl) {
    // Manually inject the state parameter into the Casdoor authorize URL.
    // This is more robust than string replacement as it handles various SDK output formats.
    const signinUrlObj = new URL(signinUrl);
    signinUrlObj.searchParams.set('state', returnUrl);
    signinUrl = signinUrlObj.toString();
  }

  // Set sso_probed cookie to prevent infinite redirect loops when the
  // middleware auto-probes for an existing Casdoor session. TTL: 5 minutes.
  const response = NextResponse.redirect(signinUrl);
  response.cookies.set('sso_probed', '1', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 5 * 60, // 5 minutes
  });

  return response;
}
