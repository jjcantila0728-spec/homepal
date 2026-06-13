import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth';

// Lightweight gate: middleware only checks for the presence of the session cookie
// (cryptographic verification needs node:crypto and happens in route handlers /
// server components via getSessionUser). Protects the app shell from anonymous
// access and bounces logged-in users away from the auth screens.
export function middleware(req: NextRequest) {
  const hasSession = Boolean(req.cookies.get(SESSION_COOKIE)?.value);
  const { pathname } = req.nextUrl;

  const isAuthPage = pathname === '/login' || pathname === '/register';
  const isApp = pathname.startsWith('/app');

  if (isApp && !hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  if (isAuthPage && hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = '/app';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/app/:path*', '/login', '/register'],
};
