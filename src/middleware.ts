// InwardsFlow — Route & Session Middleware.
// Config comes only from env vars via @/lib/config (fail-fast, no hard-coded
// project URL or key). Protects every app page AND every /api route:
// unauthenticated API calls get 401 JSON, unauthenticated pages redirect.
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { getSupabaseUrl, getSupabaseAnonKey } from '@/lib/config';

const PROTECTED_PAGE_PREFIXES = [
  '/dashboard',
  '/workbench',
  '/intake',
  '/users',
  '/audit',
  '/catalog',
  '/purchase-orders',
  '/print',
];

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  let isAuthenticated = false;

  try {
    const supabase = createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: any }>) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    });

    const {
      data: { user },
    } = await supabase.auth.getUser();

    isAuthenticated = Boolean(user);
  } catch {
    // Config missing or Supabase unreachable: treat as unauthenticated.
    // Protected routes fail CLOSED, never open.
    isAuthenticated = false;
  }

  const url = request.nextUrl.clone();
  const isApiRoute = url.pathname.startsWith('/api/');
  const isLoginPage = url.pathname === '/login';
  const isProtectedPage = PROTECTED_PAGE_PREFIXES.some((p) => url.pathname.startsWith(p));

  if (!isAuthenticated && isApiRoute) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isAuthenticated && isProtectedPage) {
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  if (isAuthenticated && isLoginPage) {
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
