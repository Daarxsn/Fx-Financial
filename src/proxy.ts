import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PAGES = new Set(["/login", "/activate", "/favicon.ico", "/robots.txt", "/sitemap.xml"]);

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // API endpoints have their own CSRF, authentication and permission guards.
  // Framework assets and explicitly public onboarding pages must remain reachable.
  if (
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/brand/") ||
    PUBLIC_PAGES.has(pathname)
  ) {
    return NextResponse.next();
  }

  // This is a cheap navigation gate only, not authentication proof. A present but invalid,
  // expired or revoked cookie is still rejected by the database-backed workspace layout.
  if (!request.cookies.get("fx_session")?.value) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/:path*"],
};
