import { NextResponse } from 'next/server';
import { casdoorSDK } from '@/lib/auth/casdoor';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const redirectUri = `${url.origin}/api/auth/callback`;
  const signinUrl = casdoorSDK.getSigninUrl(redirectUri);

  return NextResponse.redirect(signinUrl);
}
