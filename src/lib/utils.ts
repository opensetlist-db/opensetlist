/**
 * Generate a URL-friendly slug from a string.
 * Handles Korean, Japanese, Chinese characters by keeping them as-is (percent-encoded by browser).
 * Latin characters are lowercased and spaces become hyphens.
 */
export function nonBlank(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "") // keep letters, numbers, spaces, hyphens
    .replace(/[\s]+/g, "-") // spaces → hyphens
    .replace(/-+/g, "-") // collapse multiple hyphens
    .replace(/^-|-$/g, ""); // trim leading/trailing hyphens
}

/**
 * Serialize BigInt values to numbers for JSON compatibility.
 * Prisma returns BigInt for @id @default(autoincrement()) fields.
 * At runtime, bigint fields become numbers after JSON round-trip.
 *
 * ⚠️ Number-targeted serialization is lossy at >2^53 − 1. Use
 * `serializeBigIntAsString` when the payload carries id fields whose
 * precision must survive the JSON boundary (e.g., Album.id +
 * artists/tracks/song ids on the album detail page, where downstream
 * components compose hrefs and Prisma queries off these values).
 */
export function serializeBigInt<T>(obj: T): T {
  return JSON.parse(
    JSON.stringify(obj, (_key, value) =>
      typeof value === "bigint" ? Number(value) : value
    )
  );
}

/**
 * Type-level companion to `serializeBigIntAsString`'s runtime
 * behaviour. Walks the shape recursively and rewrites:
 *
 *   - `bigint` → `string` (the actual transform `serializeBigIntAsString`
 *     applies via `value.toString()` in its JSON replacer)
 *   - `Date`   → `string` (JSON.stringify serialises Date instances
 *     to ISO strings; the value comes out as `string` on the other
 *     side, not `Date`)
 *   - Arrays / nested objects → recurse element-wise
 *
 * Use this when declaring the consumer-side type of a payload that
 * passed through `serializeBigIntAsString` (e.g. `RelatedEvent`,
 * the page-level `getAlbum` return shape, `<AlbumInfoCard>` props).
 * Mirrors the wire shape so the type system stops claiming the
 * payload still carries `bigint`/`Date` after the serializer ran.
 */
export type BigIntStringified<T> =
  T extends bigint ? string :
  T extends Date ? string :
  T extends (infer U)[] ? BigIntStringified<U>[] :
  T extends object ? { [K in keyof T]: BigIntStringified<T[K]> } :
  T;

/**
 * Same shape as `serializeBigInt` but converts BigInt to a string
 * representation rather than a JS number. Use this when the payload
 * carries id-bearing BigInt fields whose precision must survive
 * round-tripping to a client component or fetch response.
 *
 * Why string and not just number: ids above `Number.MAX_SAFE_INTEGER`
 * (2^53 − 1) silently round when coerced to number. At Phase 1
 * catalog scale (100s of ids) this never bites in practice, but the
 * conversion is one-way — once an id is rounded, any downstream code
 * that re-feeds it into a Prisma `where: { id: BigInt(n) }` query
 * lands on the wrong row. Strings dodge the rounding entirely;
 * BigInt(stringId) at the DB boundary reverses cleanly.
 *
 * The return type is `BigIntStringified<T>` so the static type stays
 * honest about what survived the serialiser: bigint and Date both
 * arrive on the other side as strings. Consumers that compare,
 * format, or feed these values back into Prisma queries get the
 * right typing without an `as unknown as` cast.
 */
export function serializeBigIntAsString<T>(obj: T): BigIntStringified<T> {
  return JSON.parse(
    JSON.stringify(obj, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value
    )
  ) as BigIntStringified<T>;
}

/**
 * Pick a locale-specific translation from a translations array.
 * Falls back to "ko" → "en" → first available.
 */
export function pickTranslation<T extends { locale: string }>(
  translations: T[],
  locale: string
): T | undefined {
  return (
    translations.find((t) => t.locale === locale) ??
    translations.find((t) => t.locale === "ko") ??
    translations.find((t) => t.locale === "en") ??
    translations[0]
  );
}

/**
 * Strict locale lookup — no fallback chain.
 * Use for fields that have an "original" on the parent record (Song.originalTitle,
 * Song.variantLabel, Album.originalTitle). If the locale-specific row is missing,
 * the caller should fall back to the parent's original field — NOT to another
 * locale's translation, which would surface the wrong language (e.g. Korean
 * variantLabel shown to a Japanese viewer).
 */
export function pickLocaleTranslation<T extends { locale: string }>(
  translations: readonly T[],
  locale: string
): T | undefined {
  return translations.find((t) => t.locale === locale);
}

/**
 * Format a date for display. Returns locale-appropriate date string.
 *
 * `options` lets callers override the default `{year, month, day}`
 * shape — needed for surfaces that want only month, or weekday +
 * month + day (home cards). The default preserves the original
 * behavior so existing call sites don't change. When formatting a
 * UTC-stored date for display, callers should pass
 * `{ ..., timeZone: "UTC" }` so the rendered day matches how the
 * value is stored (CLAUDE.md §"Date & Time").
 */
const DEFAULT_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "long",
  day: "numeric",
};

/**
 * Desktop format used by every "list of events grouped by series"
 * surface — event list (`/[locale]/events`), artist / song / member
 * history tabs, series LegCard. Includes year so a row carries the
 * full calendar context without depending on the surrounding header
 * (operator feedback 2026-04-29 — "show year in all pages,
 * consistently").
 *
 * `timeZone: "UTC"` is mandatory: stored dates are UTC, and
 * formatting in the server-local TZ silently shifts the rendered
 * date by hours-to-days depending on where the request happens to
 * land (Vercel edge region / dev laptop / CI). Per CLAUDE.md
 * UTC-only rule, every comparison/render of a stored date must
 * pass through `timeZone: "UTC"`.
 */
export const HISTORY_ROW_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
};
/**
 * URL scheme guard for operator-entered external links — productUrl
 * inputs on AlbumStoreListing and similar admin surfaces. Returns
 * `true` only when the value parses as a real URL with an http/https
 * scheme; rejects `javascript:`, `data:`, `vbscript:`, malformed
 * strings, and nullish inputs. Asserts the input as a non-nullable
 * string for the truthy branch so callers can use it as a type guard.
 *
 * Originally lived inline in ListingCard; lifted here so admin
 * surfaces (ListingsClient) can apply the same scheme allowlist
 * instead of rendering operator-typed `href` verbatim.
 */
export function isSafeExternalUrl(
  url: string | null | undefined,
): url is string {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export function formatDate(
  date: Date | string | null | undefined,
  locale: string,
  options: Intl.DateTimeFormatOptions = DEFAULT_FORMAT_OPTIONS
): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  const localeMap: Record<string, string> = {
    ko: "ko-KR",
    ja: "ja-JP",
    en: "en-US",
    "zh-CN": "zh-CN",
  };
  // Defense in depth: a request whose locale segment bypasses the
  // [locale] page guards (e.g. scanner traffic to /.env, /.git) can
  // reach here with an arbitrary string. Intl.DateTimeFormat throws
  // RangeError on unknown locale tags, so try the resolved locale and
  // fall back to en-US on any rejection rather than 500ing the page.
  const resolved = localeMap[locale] ?? locale;
  try {
    return d.toLocaleDateString(resolved, options);
  } catch {
    return d.toLocaleDateString("en-US", options);
  }
}

/**
 * Release-year extractor shared by the album surfaces (AlbumCard's
 * three variants + the `/albums` list page's year grouping). Returns
 * the UTC year of a date-only / ISO-string / Date value, or null when
 * the input is null or unparseable.
 *
 * UTC per the CLAUDE.md date rule: `Album.releaseDate` is a date-only
 * column, so the year is timezone-stable, but reading it through a
 * local-time getter would be a latent bug if the column ever carried a
 * time — `getUTCFullYear` keeps the boundary correct regardless.
 */
export function parseReleaseYear(date: string | Date | null): number | null {
  if (date === null) return null;
  const d = date instanceof Date ? date : new Date(date);
  const year = d.getUTCFullYear();
  return Number.isNaN(year) ? null : year;
}
