import {
  AdminFieldResult,
  nullableString,
  originalLanguage as parseOriginalLanguage,
  parseTranslationItems,
  requireString,
} from "@/lib/admin-input";

export type ArtistTranslationInput = {
  locale: string;
  name: string;
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
    const bio = nullableString(t.bio, `translations[${i}].bio`);
    if (!bio.ok) return bio;
    return {
      ok: true,
      value: { locale: locale.value, name: name.value, bio: bio.value },
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
