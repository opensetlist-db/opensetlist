// @vitest-environment node
//
// Admin routes save translations per locale (upsert); deleting all of an
// entity's translation rows and recreating them from the body wipes the
// locales and columns a partial save did not send. eslint.config.mjs
// forbids `<x>Translation.deleteMany(` under src/app/api/admin with this
// `no-restricted-syntax` entry — pinned here so a selector typo can't
// silently turn the rule into a no-op.
import { describe, it } from "vitest";
import { RuleTester, type Rule } from "eslint";
import { builtinRules } from "eslint/use-at-your-own-risk";
import tsParser from "@typescript-eslint/parser";
import { adminTranslationDeleteRestriction } from "../../../eslint-rules/admin-translation-writes.mjs";

const rule = builtinRules.get("no-restricted-syntax") as Rule.RuleModule;

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({ languageOptions: { parser: tsParser } });
const options = [adminTranslationDeleteRestriction];

tester.run("admin translation writes", rule, {
  valid: [
    // The per-locale upsert the rule points to.
    { code: "await tx.stageIdentityTranslation.upsert({ where, create, update });", options },
    // deleteMany on a non-translation model stays allowed.
    { code: "await tx.songArtist.deleteMany({ where: { songId } });", options },
    // A model whose name merely contains "Translation" in the middle.
    { code: "await prisma.translationJob.deleteMany({});", options },
  ],
  invalid: [
    {
      code: "await tx.artistTranslation.deleteMany({ where: { artistId } });",
      options,
      errors: [{ message: adminTranslationDeleteRestriction.message }],
    },
    {
      // Batch-transaction form, `prisma.` receiver.
      code: "prisma.$transaction([prisma.songTranslation.deleteMany({ where: { songId } })]);",
      options,
      errors: [{ message: adminTranslationDeleteRestriction.message }],
    },
  ],
});
