// @vitest-environment node
//
// Public entity links go through src/lib/seo/entityUrl.ts; eslint.config.mjs
// errors on hand-built `/${locale}/<kind>/${id}` templates with these
// `no-restricted-syntax` entries — pinned here so a selector typo (or an
// esquery regex quirk) can't silently turn the rule into a no-op.
import { describe, it } from "vitest";
import { RuleTester, type Rule } from "eslint";
import { builtinRules } from "eslint/use-at-your-own-risk";
import tsParser from "@typescript-eslint/parser";
import { entityUrlPathRestrictions } from "../../../eslint-rules/entity-url-paths.mjs";

const rule = builtinRules.get("no-restricted-syntax") as Rule.RuleModule;

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

const options = entityUrlPathRestrictions;
const error = { message: options[0].message };

tester.run("hand-built entity URLs", rule, {
  valid: [
    // The helpers the rule points to.
    { code: 'const h = entityPath("songs", locale, song.id, song.slug);', options },
    { code: "const h = eventHref(locale, event.id, event.slug);", options },
    // A query string after the helper's path.
    {
      code: 'const h = `${entityPath("artists", locale, a.id, a.slug)}?tab=albums`;',
      options,
    },
    // API paths are fetch targets, not public links.
    { code: "fetch(`/api/events/${eventId}/wishes`);", options },
    { code: "fetch(`/api/artists/${id}/current-members`);", options },
    // List pages: nothing interpolated after the kind.
    { code: "const h = `/${locale}/events`;", options },
    { code: "const h = `/${locale}/songs?q=${q}`;", options },
    // A kind name inside a longer segment.
    { code: "const h = `/${locale}/my-songs/${id}`;", options },
  ],
  invalid: [
    {
      code: "const h = `/${locale}/albums/${album.id}/${album.slug}`;",
      options,
      errors: [error],
    },
    {
      // Slug dropped: the shape the board links used.
      code: "const e = <Link href={`/${locale}/songs/${p.songId}`}>x</Link>;",
      options,
      errors: [error],
    },
    {
      // Hand-built slug segment.
      code: "const h = `/${locale}/songs/${s.song.id}${slugSegment}`;",
      options,
      errors: [error],
    },
    {
      // Locale-free path for the i18n Link.
      code: "const e = <IntlLink href={`/series/${child.id}/${child.slug}`} />;",
      options,
      errors: [error],
    },
    {
      // Absolute share URL.
      code: "const u = `${BASE_URL}/${locale}/events/${eventId}`;",
      options,
      errors: [error],
    },
    {
      code: "const h = `/${locale}/members/${id}/${member.slug}?tab=songs`;",
      options,
      errors: [error],
    },
  ],
});
