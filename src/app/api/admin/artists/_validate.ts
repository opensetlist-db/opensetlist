import {
  AdminFieldResult,
  nullableBoolean,
  nullableHexColor,
  nullableInt,
  nullableString,
  originalLanguage as parseOriginalLanguage,
  parseTranslationItems,
  requireString,
} from "@/lib/admin-input";

/** Artist-level display fields the admin form edits. A key absent
 *  from the result means "leave the stored value alone". */
export type ArtistDisplayFields = {
  color?: string | null;
  sortOrder?: number | null;
  isSideProject?: boolean;
};

/**
 * `color` (hex), `sortOrder` (integer or empty) and `isSideProject`
 * from an admin artist body.
 *
 * Preserve-on-missing, for create AND update: a key the body does not
 * carry is left out of the result, so the Prisma write leaves that
 * column alone (update) or takes the schema default (create). The
 * colours were backfilled by CSV import long before the form could
 * edit them; a PUT from a client that predates these fields (an old
 * tab, a script) must not wipe them. A key that IS present is
 * authoritative: `color: ""` / `null` clears the colour, `sortOrder:
 * ""` / `null` clears the order, `isSideProject: null` resets the flag
 * to false (the column is non-null).
 */
export function parseArtistDisplayFields(
  body: Record<string, unknown>
): AdminFieldResult<ArtistDisplayFields> {
  const out: ArtistDisplayFields = {};
  if ("color" in body) {
    const color = nullableHexColor(body.color, "color");
    if (!color.ok) return color;
    out.color = color.value;
  }
  if ("sortOrder" in body) {
    const sortOrder = nullableInt(body.sortOrder, "sortOrder");
    if (!sortOrder.ok) return sortOrder;
    out.sortOrder = sortOrder.value;
  }
  if ("isSideProject" in body) {
    const side = nullableBoolean(body.isSideProject, "isSideProject");
    if (!side.ok) return side;
    out.isSideProject = side.value ?? false;
  }
  return { ok: true, value: out };
}

export type ArtistTranslationInput = {
  locale: string;
  name: string;
  shortName: string | null;
  bio: string | null;
};

export type StageIdentityTranslationInput = {
  locale: string;
  name: string;
};

export type RealPersonTranslationInput = {
  locale: string;
  name: string;
  stageName: string | null;
};

export type ParsedRealPerson = {
  originalName: string;
  originalShortName: string | null;
  originalStageName: string | null;
  originalLanguage: string;
  translations: RealPersonTranslationInput[];
};

export type ParsedStageIdentity = {
  type: "character" | "persona";
  color: string | null;
  // Official member order (see `src/lib/memberOrder.ts`); null = not
  // numbered yet, sorts after the numbered members.
  sortOrder: number | null;
  originalName: string;
  originalShortName: string | null;
  originalLanguage: string;
  translations: StageIdentityTranslationInput[];
  realPerson: ParsedRealPerson | null;
};

export function parseArtistTranslations(
  raw: unknown
): AdminFieldResult<ArtistTranslationInput[]> {
  return parseTranslationItems<ArtistTranslationInput>(raw, (t, i) => {
    const locale = requireString(t.locale, `translations[${i}].locale`);
    if (!locale.ok) return locale;
    const name = requireString(t.name, `translations[${i}].name`);
    if (!name.ok) return name;
    // shortName must round-trip: the edit route deletes and recreates
    // every ArtistTranslation from this payload, so a field dropped here
    // is wiped from the DB on each admin save (the chip/short-label
    // fallback in displayNameWithFallback then shows the full name).
    const shortName = nullableString(
      t.shortName,
      `translations[${i}].shortName`
    );
    if (!shortName.ok) return shortName;
    const bio = nullableString(t.bio, `translations[${i}].bio`);
    if (!bio.ok) return bio;
    return {
      ok: true,
      value: {
        locale: locale.value,
        name: name.value,
        shortName: shortName.value,
        bio: bio.value,
      },
    };
  });
}

export function parseStageIdentityTranslations(
  raw: unknown,
  prefix: string
): AdminFieldResult<StageIdentityTranslationInput[]> {
  return parseTranslationItems<StageIdentityTranslationInput>(raw, (t, i) => {
    const locale = requireString(t.locale, `${prefix}[${i}].locale`);
    if (!locale.ok) return locale;
    const name = requireString(t.name, `${prefix}[${i}].name`);
    if (!name.ok) return name;
    return { ok: true, value: { locale: locale.value, name: name.value } };
  });
}

export function parseRealPersonTranslations(
  raw: unknown,
  prefix: string
): AdminFieldResult<RealPersonTranslationInput[]> {
  return parseTranslationItems<RealPersonTranslationInput>(raw, (t, i) => {
    const locale = requireString(t.locale, `${prefix}[${i}].locale`);
    if (!locale.ok) return locale;
    const name = requireString(t.name, `${prefix}[${i}].name`);
    if (!name.ok) return name;
    const stageName = nullableString(t.stageName, `${prefix}[${i}].stageName`);
    if (!stageName.ok) return stageName;
    return {
      ok: true,
      value: {
        locale: locale.value,
        name: name.value,
        stageName: stageName.value,
      },
    };
  });
}

export function parseRealPerson(
  raw: unknown,
  prefix: string
): AdminFieldResult<ParsedRealPerson> {
  if (!raw || typeof raw !== "object") {
    return { ok: false, message: `${prefix} must be an object` };
  }
  const rp = raw as Record<string, unknown>;
  const name = requireString(rp.originalName, `${prefix}.originalName`);
  if (!name.ok) return name;
  const shortName = nullableString(
    rp.originalShortName,
    `${prefix}.originalShortName`
  );
  if (!shortName.ok) return shortName;
  const stageName = nullableString(
    rp.originalStageName,
    `${prefix}.originalStageName`
  );
  if (!stageName.ok) return stageName;
  const language = parseOriginalLanguage(rp.originalLanguage);
  if (!language.ok) return language;
  const translations = parseRealPersonTranslations(
    rp.translations,
    `${prefix}.translations`
  );
  if (!translations.ok) return translations;
  return {
    ok: true,
    value: {
      originalName: name.value,
      originalShortName: shortName.value,
      originalStageName: stageName.value,
      originalLanguage: language.value,
      translations: translations.value,
    },
  };
}

export function parseStageIdentity(
  raw: unknown,
  index: number
): AdminFieldResult<ParsedStageIdentity> {
  const prefix = `stageIdentities[${index}]`;
  if (!raw || typeof raw !== "object") {
    return { ok: false, message: `${prefix} must be an object` };
  }
  const si = raw as Record<string, unknown>;
  if (si.type !== "character" && si.type !== "persona") {
    return {
      ok: false,
      message: `${prefix}.type must be "character" or "persona"`,
    };
  }
  const color = nullableString(si.color, `${prefix}.color`);
  if (!color.ok) return color;
  // A new member: absent, empty and null all mean "not numbered".
  const sortOrder = nullableInt(si.sortOrder, `${prefix}.sortOrder`);
  if (!sortOrder.ok) return sortOrder;
  const name = requireString(si.originalName, `${prefix}.originalName`);
  if (!name.ok) return name;
  const shortName = nullableString(si.originalShortName, `${prefix}.originalShortName`);
  if (!shortName.ok) return shortName;
  const language = parseOriginalLanguage(si.originalLanguage);
  if (!language.ok) return language;
  const translations = parseStageIdentityTranslations(
    si.translations,
    `${prefix}.translations`
  );
  if (!translations.ok) return translations;

  let realPerson: ParsedRealPerson | null = null;
  if (si.realPerson !== undefined && si.realPerson !== null) {
    const parsed = parseRealPerson(si.realPerson, `${prefix}.realPerson`);
    if (!parsed.ok) return parsed;
    realPerson = parsed.value;
  }

  return {
    ok: true,
    value: {
      type: si.type,
      color: color.value,
      sortOrder: sortOrder.value,
      originalName: name.value,
      originalShortName: shortName.value,
      originalLanguage: language.value,
      translations: translations.value,
      realPerson,
    },
  };
}

export function parseStageIdentities(
  raw: unknown
): AdminFieldResult<ParsedStageIdentity[]> {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) {
    return { ok: false, message: "stageIdentities must be an array" };
  }
  const out: ParsedStageIdentity[] = [];
  for (let i = 0; i < raw.length; i++) {
    const parsed = parseStageIdentity(raw[i], i);
    if (!parsed.ok) return parsed;
    out.push(parsed.value);
  }
  return { ok: true, value: out };
}
