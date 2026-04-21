import { NextResponse } from "next/server";
import { resolveOriginalLanguage } from "@/lib/csv-parse";

export type AdminFieldResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

export function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

// Reject non-object payloads with 400 — destructuring null/array/unparseable throws 500.
export async function parseJsonBody(
  request: Request
): Promise<
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: NextResponse }
> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: badRequest("Request body must be valid JSON") };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      response: badRequest("Request body must be a JSON object"),
    };
  }
  return { ok: true, body: raw as Record<string, unknown> };
}

export function requireString(
  value: unknown,
  field: string
): AdminFieldResult<string> {
  if (typeof value !== "string") {
    return { ok: false, message: `${field} is required` };
  }
  const t = value.trim();
  if (t.length === 0) {
    return { ok: false, message: `${field} is required` };
  }
  return { ok: true, value: t };
}

export function nullableString(
  value: unknown,
  field: string
): AdminFieldResult<string | null> {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: null };
  }
  if (typeof value !== "string") {
    return { ok: false, message: `${field} must be a string` };
  }
  const t = value.trim();
  return { ok: true, value: t.length > 0 ? t : null };
}

// Required for admin writes; CSV import keeps the lenient `resolveOriginalLanguage` default.
export function originalLanguage(value: unknown): AdminFieldResult<string> {
  if (value === undefined || value === null || value === "") {
    return { ok: false, message: "originalLanguage is required" };
  }
  if (typeof value !== "string") {
    return { ok: false, message: "originalLanguage must be a string" };
  }
  try {
    return { ok: true, value: resolveOriginalLanguage(value) };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export function translationsArray(
  value: unknown
): AdminFieldResult<unknown[]> {
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, message: "translations must be a non-empty array" };
  }
  return { ok: true, value };
}

// Required enum string. The `as` cast in the destructure is compile-time only;
// without this an invalid enum value reaches Prisma and 500s.
export function enumValue<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[]
): AdminFieldResult<T> {
  if (typeof value !== "string" || value.length === 0) {
    return { ok: false, message: `${field} is required` };
  }
  if (!(allowed as readonly string[]).includes(value)) {
    return {
      ok: false,
      message: `${field} must be one of: ${allowed.join(", ")}`,
    };
  }
  return { ok: true, value: value as T };
}

export function nullableEnumValue<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[]
): AdminFieldResult<T | null> {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: null };
  }
  if (typeof value !== "string") {
    return { ok: false, message: `${field} must be a string` };
  }
  if (!(allowed as readonly string[]).includes(value)) {
    return {
      ok: false,
      message: `${field} must be one of: ${allowed.join(", ")}`,
    };
  }
  return { ok: true, value: value as T };
}

// Optional BigInt-coercible id. Bare `BigInt(value)` throws SyntaxError on "abc"
// or TypeError on objects. `isSafeInteger` rejects values past 2^53-1 — JSON
// numbers above that have already lost precision before reaching us, so they'd
// silently bind to the wrong FK row.
export function nullableBigIntId(
  value: unknown,
  field: string
): AdminFieldResult<bigint | null> {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: null };
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return { ok: true, value: BigInt(value) };
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return { ok: true, value: BigInt(value) };
  }
  return {
    ok: false,
    message: `${field} must be a non-negative integer or digit string`,
  };
}

// Optional boolean. `body as { hasBoard?: boolean }` is compile-time only;
// "false" or {} would otherwise reach Prisma.
export function nullableBoolean(
  value: unknown,
  field: string
): AdminFieldResult<boolean | null> {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: null };
  }
  if (typeof value === "boolean") {
    return { ok: true, value };
  }
  return { ok: false, message: `${field} must be a boolean` };
}

// Optional array of strings. Returns [] for undefined/null so callers can
// `.length` and `.map` without further branches.
export function nullableStringArray(
  value: unknown,
  field: string
): AdminFieldResult<string[]> {
  if (value === undefined || value === null) return { ok: true, value: [] };
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    return { ok: false, message: `${field} must be an array of strings` };
  }
  return { ok: true, value: value as string[] };
}

export type LocalizedTranslation = {
  locale: string;
  name: string;
  shortName: string | null;
  description: string | null;
};

/**
 * Iterate a translations array (must be non-empty), enforcing locale uniqueness,
 * and delegate per-item parsing to the caller. Each item is asserted to be an
 * object before being passed in, so parsers can read keys without further guards.
 */
export function parseTranslationItems<T extends { locale: string }>(
  raw: unknown,
  parseItem: (item: Record<string, unknown>, index: number) => AdminFieldResult<T>
): AdminFieldResult<T[]> {
  const arr = translationsArray(raw);
  if (!arr.ok) return arr;

  const out: T[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < arr.value.length; i++) {
    const item = arr.value[i];
    if (!item || typeof item !== "object") {
      return { ok: false, message: `translations[${i}] must be an object` };
    }
    const parsed = parseItem(item as Record<string, unknown>, i);
    if (!parsed.ok) return parsed;
    if (seen.has(parsed.value.locale)) {
      return {
        ok: false,
        message: `translations contains duplicate locale "${parsed.value.locale}"`,
      };
    }
    seen.add(parsed.value.locale);
    out.push(parsed.value);
  }
  return { ok: true, value: out };
}

/**
 * Parse a translations array shaped { locale, name, shortName?, description? }
 * (Group, EventSeries).
 */
export function parseLocalizedTranslations(
  raw: unknown
): AdminFieldResult<LocalizedTranslation[]> {
  return parseTranslationItems<LocalizedTranslation>(raw, (t, i) => {
    const locale = requireString(t.locale, `translations[${i}].locale`);
    if (!locale.ok) return locale;
    const name = requireString(t.name, `translations[${i}].name`);
    if (!name.ok) return name;
    const shortName = nullableString(t.shortName, `translations[${i}].shortName`);
    if (!shortName.ok) return shortName;
    const description = nullableString(
      t.description,
      `translations[${i}].description`
    );
    if (!description.ok) return description;
    return {
      ok: true,
      value: {
        locale: locale.value,
        name: name.value,
        shortName: shortName.value,
        description: description.value,
      },
    };
  });
}
