export const dynamic = "force-dynamic";

class SentryExampleAPIError extends Error {
  constructor(message: string | undefined) {
    super(message);
    this.name = "SentryExampleAPIError";
  }
}

// A faulty API route to test Sentry's error monitoring. Gated behind an
// env flag so it cannot be hit on production without explicit opt-in —
// left ungated it's a public endpoint that throws on every GET, which
// any visitor (or crawler) could use to spam the Sentry quota. Operator
// sets ENABLE_SENTRY_VERIFICATION_ROUTES=true on Vercel for the
// verification window only, then unsets it.
export function GET() {
  if (process.env.ENABLE_SENTRY_VERIFICATION_ROUTES !== "true") {
    return new Response(null, { status: 404 });
  }
  throw new SentryExampleAPIError(
    "This error is raised on the backend called by the example page.",
  );
}
