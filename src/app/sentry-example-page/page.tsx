import { notFound } from "next/navigation";

import SentryExamplePageClient from "./SentryExamplePageClient";

// Temporary verification page for Sentry setup. Gated behind the same
// server env flag as the companion API route — without this gate the
// page's button throws SentryExampleFrontendError on every click, which
// any visitor could use to spam the Sentry quota. 404 unless the
// operator has explicitly enabled verification.
export default function Page() {
  if (process.env.ENABLE_SENTRY_VERIFICATION_ROUTES !== "true") {
    notFound();
  }
  return <SentryExamplePageClient />;
}
