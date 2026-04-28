import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PATH_PREFIXES = [
  '/',
  '/api/auth',
  '/api/health',
  '/api/share/',
  '/share',
  '/_next',
  '/favicon',
  '/logos',
  '/fonts',
];

const PUBLIC_EXACT_PATHS = new Set(['/', '/api/health']);

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT_PATHS.has(pathname)) return true;

  // Static assets
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/logos') ||
    pathname.startsWith('/fonts') ||
    pathname.endsWith('.svg') ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.ico') ||
    pathname.endsWith('.jpg') ||
    pathname.endsWith('.css') ||
    pathname.endsWith('.js')
  ) {
    return true;
  }

  for (const prefix of PUBLIC_PATH_PREFIXES) {
    if (prefix !== '/' && pathname.startsWith(prefix)) return true;
  }

  return false;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get('casdoor_token')?.value;
  if (!token) {
    // API routes -> 401 JSON
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }
    // Page routes -> attempt SSO auto-login or redirect to home
    // If we haven't probed Casdoor for an existing session yet, redirect to
    // the login endpoint which will bounce through Casdoor. If the user has an
    // active Casdoor session, they'll be logged in transparently. The login
    // route sets a `sso_probed` cookie to prevent infinite redirect loops.
    const ssoProbed = request.cookies.get('sso_probed')?.value;
    if (!ssoProbed) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = '/api/auth/login';
      loginUrl.search = '';
      loginUrl.searchParams.set('returnUrl', pathname + (request.nextUrl.search || ''));
      return NextResponse.redirect(loginUrl);
    }
    // Already probed — fall back to home with login prompt
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.searchParams.set('login', 'required');
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
