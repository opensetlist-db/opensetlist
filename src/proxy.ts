import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

export default createMiddleware(routing);

export const config = {
  matcher: [
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
