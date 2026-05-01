import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

// Sentry's `captureRequestError` does NOT filter Next.js's control-flow
// throws — `notFound()` and `redirect()` both work by throwing an Error
// with a magic `digest`, and the SDK forwards them to Sentry as
// unhandled exceptions. The result is a Sentry alert for every 404,
// dominated by bot/crawler probes for paths like `/apple-touch-icon.png`,
// `/.well-known/*`, and random `.php` scrapers.
//
// The SDK does ship `isNotFoundNavigationError` / `isRedirectNavigationError`
// helpers internally (see `@sentry/nextjs/.../common/nextNavigationErrorUtils`)
// but they aren't part of the public export and aren't called from
// `captureRequestError` itself. Inline the digest check here so 404 noise
// stops reaching Sentry. 404 rate monitoring belongs in Vercel analytics,
// not the exception tracker.
export const onRequestError: typeof Sentry.captureRequestError = (
  error,
  request,
  errorContext,
) => {
  const digest = (error as { digest?: unknown } | null)?.digest;
  if (typeof digest === "string") {
    if (
      digest === "NEXT_NOT_FOUND" ||
      digest === "NEXT_HTTP_ERROR_FALLBACK;404" ||
      digest.startsWith("NEXT_REDIRECT;")
    ) {
      return;
    }
  }
  return Sentry.captureRequestError(error, request, errorContext);
};
