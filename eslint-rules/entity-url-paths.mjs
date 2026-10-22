/**
 * `no-restricted-syntax` entries for hand-built public entity URLs.
 *
 * Every public entity link goes through `src/lib/seo/entityUrl.ts`
 * (`entityPath`, `absoluteUrl`, or a helper built on them such as
 * `eventHref`) — repo CLAUDE.md "URL Strategy". A hand-built
 * `` `/${locale}/songs/${id}` `` drifts from the canonical form: it
 * drops the slug (every click then costs a 308 hop), or it mints
 * `/…/{id}/` for an empty slug, which Next normalises to `/…/{id}` and
 * the page redirects straight back — an infinite 308 loop that
 * `entityPath` alone guards against. Review kept catching these by hand,
 * once with a BigInt id narrowed to a JS number on the way; a mechanical
 * rule belongs in lint.
 *
 * The pattern is a template chunk that is exactly `/<kind>/` and is
 * followed by an interpolation — the id. That covers both shapes:
 *
 *   `/songs/${id}`                → chunks "/songs/", ""
 *   `/${locale}/songs/${id}/${s}` → chunks "/", "/songs/", "/", ""
 *
 * and leaves API paths alone (`/api/events/${id}` is one chunk
 * "/api/events/"), as well as list pages (`/${locale}/events` ends in a
 * tail chunk with nothing interpolated after it).
 *
 * eslint.config.mjs applies these to `src/app/[locale]/**` and
 * `src/components/**` only. Admin and API routes build operator and
 * fetch paths, not public links; `src/lib/` holds the approved builders
 * themselves.
 */
const KINDS = "artists|songs|series|albums|events|members";

const message =
  "Hand-built entity URL: use entityPath(kind, locale, id, slug) from src/lib/seo/entityUrl.ts (or eventHref) — it owns the canonical form and the empty-slug case. Pass the raw bigint/string id, not a serializeBigInt number.";

export const entityUrlPathRestrictions = [
  {
    // `\x2F` is `/`: esquery's regex syntax ends the pattern at the
    // first slash, so a literal one cannot appear inside it.
    selector: `TemplateElement[tail=false][value.raw=/^\\x2F(?:${KINDS})\\x2F$/]`,
    message,
  },
];
