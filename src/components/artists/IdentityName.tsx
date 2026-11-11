import { resolveDisplayPair } from "@/lib/display";

type Identity = {
  originalName: string | null;
  originalLanguage: string;
  translations: readonly { locale: string; name: string }[];
};

export function identityName(identity: Identity, locale: string, fallback = "") {
  const original = identity.originalName ||
    identity.translations.find((row) => row.locale === identity.originalLanguage)?.name;
  if (!original) return { main: fallback, sub: null, lang: locale, locale };

  const { main, sub } = resolveDisplayPair(
    { original, originalLanguage: identity.originalLanguage },
    identity.translations,
    locale,
    "name",
  );
  return { main, sub, lang: identity.originalLanguage, locale };
}

export type IdentityNamePair = ReturnType<typeof identityName>;

export function identityNameText({ main, sub }: IdentityNamePair) {
  return sub ? main + " / " + sub : main;
}

export function IdentityName({ name }: { name: IdentityNamePair }) {
  return (
    <span className="min-w-0 text-[max(12px,1em)] [overflow-wrap:anywhere]">
      <span lang={name.lang}>{name.main}</span>
      {name.sub && <small className="block text-[max(11px,0.85em)]" lang={name.locale}>{name.sub}</small>}
    </span>
  );
}
