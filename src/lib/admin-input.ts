import { NextResponse } from "next/server";
import { resolveOriginalLanguage } from "@/lib/csv-parse";

export type AdminFieldResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

export function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
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

export function originalLanguage(value: unknown): AdminFieldResult<string> {
  if (value !== undefined && value !== null && typeof value !== "string") {
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
