import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "./i18n/routing";
import { COOKIE_NAME, isValidAdminSession } from "./lib/admin-session";

const intlMiddleware = createMiddleware(routing);

// Only the login endpoint may be called without an admin session.
const ADMIN_API_PUBLIC = new Set(["/api/admin/login"]);

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Gate every `/api/admin/*` request in one place. Until this existed, the
  // admin API relied on each route calling verifyAdminAPI() itself, and 19
  // routes (including the CSV importer) never did — they were writable
  // without logging in. Route handlers still call verifyAdminAPI() as a
  // second layer (Next.js recommends not relying on the proxy alone).
  if (pathname === "/api/admin" || pathname.startsWith("/api/admin/")) {
    if (ADMIN_API_PUBLIC.has(pathname)) return NextResponse.next();
    if (!(await isValidAdminSession(request.cookies.get(COOKIE_NAME)?.value))) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  return intlMiddleware(request);
}

export const config = {
  matcher: [
    // Admin API gate (see above). Listed separately because the i18n
    // matcher below deliberately excludes every `/api` path.
    "/api/admin/:path*",
    // Match all pathnames except for internal Next.js paths and static files.
    //
    // Excluded paths:
    //   - api, admin, admin-login: server-rendered surfaces that don't need
    //     locale prefixing
    //   - _next, _vercel: Next.js / Vercel internal routing
    //   - monitoring: the Sentry tunnel route configured via
    //     `tunnelRoute: "/monitoring"` in next.config.ts. Sentry's browser
    //     SDK POSTs telemetry envelopes to this path; without the exclusion,
    //     this middleware adds a locale prefix (`/en/monitoring`), the
    //     framework rewrite (`/monitoring → ingest.sentry.io`) doesn't
    //     match the prefixed path, and every Sentry envelope 404s. That
    //     silently kills production observability — including the
    //     `Realtime fallback to polling` captureMessage we added in R3
    //     and any other browser-side error tracking.
    //   - .*\..*: static files (have a dot in the path)
    "/((?!api|admin|admin-login|monitoring|_next|_vercel|.*\\..*).*)",
  ],
};
