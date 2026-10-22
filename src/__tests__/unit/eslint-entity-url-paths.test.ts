// @vitest-environment node
//
// Public entity links go through src/lib/seo/entityUrl.ts; eslint.config.mjs
// errors on hand-built `/${locale}/<kind>/${id}` templates with these
// `no-restricted-syntax` entries — pinned here so a selector typo (or an
// esquery regex quirk) can't silently turn the rule into a no-op.
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ESLint, RuleTester, type Rule } from "eslint";
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

// The cases above pin the selector; these pin the eslint.config.mjs
// wiring — the files globs (`src/app/[locale]` needs its brackets
// escaped), the `error` severity, and the `local/` alias — which the
// RuleTester never loads. Same source in an in-scope and an
// out-of-scope path: the admin case passes only because the in-scope
// cases show the rule does fire.
describe("hand-built entity URLs (eslint.config.mjs wiring)", () => {
  const root = path.resolve(__dirname, "../../..");
  const code = "export const h = (locale: string, id: string) => `/${locale}/songs/${id}`;\n";
  const ruleId = "local/no-hand-built-entity-urls";

  async function hits(file: string) {
    const eslint = new ESLint({ cwd: root });
    const [result] = await eslint.lintText(code, { filePath: path.join(root, file) });
    return result.messages.filter((m) => m.ruleId === ruleId);
  }

  it.each([
    "src/components/Fixture.tsx",
    "src/app/[locale]/songs/[id]/[[...slug]]/fixture.tsx",
  ])("errors in %s", async (file) => {
    const found = await hits(file);
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe(2);
  }, 60_000);

  it.each(["src/app/admin/fixture.tsx", "src/lib/fixture.ts"])(
    "stays silent in %s",
    async (file) => {
      expect(await hits(file)).toHaveLength(0);
    },
    60_000,
  );
});
