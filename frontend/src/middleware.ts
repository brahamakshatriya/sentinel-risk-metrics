import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const isPublicRoute = createRouteMatcher([
  '/',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/health',
  '/api/health',
  '/__clerk(.*)',
]);

const PROXY_PREFIX = '/__clerk';

// Derive the Clerk Frontend API origin from the publishable key at runtime,
// using the same convention as the installed SDK's parsePublishableKey
// (@clerk/shared/keys: base64-decode key.split('_')[2], strip trailing '$').
// This keeps the proxy working for whichever Frontend API host the active
// production key embeds — no hardcoded hostname, no extra env var.
function frontendApiOrigin(): string | null {
  const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (!key) return null;
  const parts = key.split('_');
  if (parts.length < 3 || !parts[2]) return null;
  try {
    const host = atob(parts[2]).replace(/\$$/, '');
    if (!host || /[\s/]/.test(host)) return null;
    return `https://${host}`;
  } catch {
    return null;
  }
}

export default clerkMiddleware(async (auth, request) => {
  // Serve the Clerk Frontend API proxy before any auth handling.
  // Middleware executes before next.config rewrites, so this is the single
  // serving point for /__clerk/* on @clerk/nextjs 5.7.6 (which has no native
  // proxy serving). Query strings are preserved for FAPI calls.
  const { pathname, search } = request.nextUrl;
  if (pathname === PROXY_PREFIX || pathname.startsWith(`${PROXY_PREFIX}/`)) {
    const origin = frontendApiOrigin();
    if (!origin) return NextResponse.next();
    const target = new URL(pathname.slice(PROXY_PREFIX.length) || '/', origin);
    target.search = search;
    return NextResponse.rewrite(target);
  }
  if (!isPublicRoute(request)) {
    await auth().protect();
  }
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};