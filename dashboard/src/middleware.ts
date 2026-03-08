import { type NextRequest, NextResponse } from "next/server";
import { createSupabaseMiddlewareClient } from "@/lib/supabase/server";

const PUBLIC_PATHS = ["/login", "/register", "/forgot-password", "/pricing", "/docs"];

export async function middleware(request: NextRequest) {
  // Dev mode: skip all auth checks, allow access to everything
  if (process.env.NEXT_PUBLIC_SKIP_AUTH === "true") {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;

  // Landing page is always public
  if (pathname === "/") return NextResponse.next();

  // Public paths
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Auth callback route must be public
  if (pathname.startsWith("/auth/")) {
    return NextResponse.next();
  }

  const { supabase, response } = createSupabaseMiddlewareClient(request);
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("returnTo", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

// Only run middleware on pages that need protection.
// Exclude static assets, Next.js internals, and API routes.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|api/|.*\\.(?:jpg|jpeg|png|gif|svg|webp|ico|json|xml|txt|webmanifest)$).*)",
  ],
};
