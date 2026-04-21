import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: 0.1,
  enabled: process.env.VERCEL_ENV === "production",

  // Every primary key in this schema is BigInt. If a server-side error
  // bubbles up holding a Prisma result, Sentry's default JSON serializer
  // throws "Do not know how to serialize a BigInt" inside the error
  // handler, masking the original error. Coerce BigInt → string in the
  // event payload before send.
  beforeSend(event) {
    try {
      return JSON.parse(
        JSON.stringify(event, (_, v) =>
          typeof v === "bigint" ? v.toString() : v,
        ),
      );
    } catch {
      return event;
    }
  },
});
