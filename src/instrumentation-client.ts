import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // Next.js only inlines `NEXT_PUBLIC_*` env vars into the client bundle —
  // plain `VERCEL_ENV` reads as `undefined` in the browser. Vercel
  // automatically populates `NEXT_PUBLIC_VERCEL_ENV` for Next.js projects,
  // so use it for both the environment tag and the prod-only gate. The
  // Vercel env-var scoping (DSN absent outside Production) is the second
  // line of defense.
  environment:
    process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: 0.1,
  enabled: process.env.NEXT_PUBLIC_VERCEL_ENV === "production",
  ignoreErrors: [
    "ResizeObserver loop limit exceeded",
    "ResizeObserver loop completed with undelivered notifications",
    "Non-Error promise rejection captured",
  ],
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
