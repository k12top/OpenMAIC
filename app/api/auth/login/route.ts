import { casdoorSDK, casdoorConfig } from '@/lib/auth/casdoor';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const returnUrl = url.searchParams.get('returnUrl');
  const redirectUri = `${url.origin}/api/auth/callback`;
  
  let signinUrl = casdoorSDK.getSignInUrl(redirectUri);
  
  if (returnUrl) {
    // Casdoor SDK hardcodes state to appName. We replace it with our encoded returnUrl.
    signinUrl = signinUrl.replace(`state=${casdoorConfig.appName}`, `state=${encodeURIComponent(returnUrl)}`);
  }

  return NextResponse.redirect(signinUrl);
}
