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
    // Twitter (X) in-app browser injects helper scripts
    // (updateGapFiller, updateFooterPositions) that reference a
    // `CONFIG` global not always present in our scope. Sentry
    // attributes the error to our page URL because the script runs
    // inside our page context, but neither identifier exists in our
    // bundle — verified by grep. First surfaced as Sentry issue
    // 7501704113 on /ja/events/3 from Twitter 11.92 / iOS 17.1.1.
    // Two messages because WebKit ("Can't find variable: X") and
    // V8 ("X is not defined") report ReferenceErrors differently;
    // covering both means future Android-Twitter-webview reports of
    // the same root cause are also filtered.
    "Can't find variable: CONFIG",
    "CONFIG is not defined",
  ],
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
