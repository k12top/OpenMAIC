import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PATH_PREFIXES = [
  '/',
  '/api/auth',
  '/api/health',
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
    // Page routes -> redirect to home with login prompt
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
