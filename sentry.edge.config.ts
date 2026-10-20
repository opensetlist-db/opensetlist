import * as Sentry from "@sentry/nextjs";
import { scrubAnon } from "./src/lib/sentryScrub";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: 0.1,
  enabled: process.env.VERCEL_ENV === "production",
  beforeSend: (event) => scrubAnon(event),
  beforeSendTransaction: (event) => scrubAnon(event),
  // The browser anon id is a bearer credential (fan board picks,
  // impression edits): masked on every capture path — errors,
  // transactions, streamed spans, breadcrumbs. See src/lib/sentryScrub.ts.
  beforeSendSpan: (span) => scrubAnon(span),
  beforeBreadcrumb: (breadcrumb) => scrubAnon(breadcrumb),
});
