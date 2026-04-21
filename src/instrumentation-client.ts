import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: 0.1,
  // VERCEL_ENV is undefined locally and set to "preview" on preview deploys,
  // so this gate excludes both. Prod is the only environment that should
  // consume our free-tier error quota. The Vercel env-var scoping (DSN
  // absent outside Production) is the second line of defense.
  enabled: process.env.VERCEL_ENV === "production",
  ignoreErrors: [
    "ResizeObserver loop limit exceeded",
    "ResizeObserver loop completed with undelivered notifications",
    "Non-Error promise rejection captured",
  ],
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
