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

  // Disambiguate Prisma DB-query span descriptions.
  //
  // Sentry's auto "N+1 Query" detector hashes spans by their (normalized)
  // `description`. The Prisma OTel integration emits the SAME generic
  // description `prisma:client:db_query` for EVERY query it issues, so
  // when a handler runs multiple Prisma queries in parallel (e.g.
  // `Promise.all` of three different `findMany`/`groupBy` calls hitting
  // different tables) the detector groups them all under one normalized
  // template (`prisma%s%s`) and flags the transaction as a false N+1.
  //
  // Concrete case that motivated this: Sentry issue 7497375493 on
  // `GET /api/setlist`. Trace had three parallel Prisma queries —
  // `SetlistItem.findMany` (775ms) + `SetlistItemReaction.groupBy` (186ms)
  // + `SongWish.groupBy` (190ms) — all sharing description, group, and
  // hash. No actual N+1; just three different reads on `Promise.all`.
  //
  // Each `prisma:client:db_query` span has a parent
  // `prisma:client:operation` span whose `data.name` carries the
  // fully-qualified model+op string (e.g. "SetlistItem.findMany"). We
  // append that suffix to the child's description so:
  //
  //   1. A real N+1 (same Model.op repeating N times) still groups
  //      under one description and IS flagged correctly — the new
  //      suffix is constant for repeated calls of the same operation.
  //   2. Mixed parallel queries (different tables) now get distinct
  //      descriptions and are no longer false-positive grouped.
  //   3. The "prisma:client:db_query" prefix is preserved verbatim so
  //      any existing Sentry searches/dashboards keyed on that token
  //      keep working.
  //
  // Spans on `event.spans` are not guaranteed parent-before-child
  // ordered, so we pre-index by `span_id` and resolve parents in O(1).
  beforeSendTransaction(event) {
    const spans = event.spans;
    if (!spans?.length) return event;

    const byId = new Map<string, (typeof spans)[number]>();
    for (const s of spans) {
      if (s.span_id) byId.set(s.span_id, s);
    }

    for (const s of spans) {
      if (s.description !== "prisma:client:db_query") continue;
      const parent = s.parent_span_id
        ? byId.get(s.parent_span_id)
        : undefined;
      // Prisma OTel attaches the fully-qualified op on the parent
      // `prisma:client:operation` span as `data.name`. Defensive
      // null-checks for the rare case where the parent span isn't
      // present in this batch (sampling edge cases) or `name` is
      // missing on an older Prisma version — leave the description
      // unchanged in that case so we don't accidentally clobber it
      // with `undefined`.
      const opName = parent?.data?.name;
      if (typeof opName === "string" && opName.length > 0) {
        s.description = `prisma:client:db_query ${opName}`;
      }
    }
    return event;
  },
});
