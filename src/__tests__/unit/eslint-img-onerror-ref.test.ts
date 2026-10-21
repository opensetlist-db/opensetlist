// @vitest-environment node
//
// Local ESLint rule `local/img-onerror-ref` (eslint-rules/): in a "use
// client" module an `<img onError>` also carries a ref, because a
// server-rendered image that fails before hydration never fires React's
// onError. Pinned here so the rule keeps flagging the bare form and keeps
// passing the ref'd form its message asks for.
import { describe, it } from "vitest";
import { RuleTester, type Rule } from "eslint";
import tsParser from "@typescript-eslint/parser";
import ruleModule from "../../../eslint-rules/img-onerror-ref.mjs";

const rule = ruleModule as unknown as Rule.RuleModule;

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

const CLIENT = '"use client";\n';
const BARE = "const A = () => <img src={s} onError={() => fail()} />;";

tester.run("img-onerror-ref", rule, {
  valid: [
    // Positive control: the fix the message points to.
    CLIENT +
      "const A = () => <img src={s} onError={() => fail()} ref={(el) => { if (el && el.complete && el.naturalWidth === 0) fail(); }} />;",
    // A ref object checked in a hook counts too.
    CLIENT + "const A = () => <img src={s} onError={onErr} ref={imgRef} />;",
    // No onError: no failure UI to miss.
    CLIENT + "const A = () => <img src={s} alt='' />;",
    // A spread may carry the ref.
    CLIENT + "const A = (p) => <img {...p} onError={onErr} />;",
    // Not an intrinsic <img>.
    CLIENT + "const A = () => <Image src={s} onError={onErr} />;",
    CLIENT + "const A = () => <video src={s} onError={onErr} />;",
    // Server modules are ignored — the same code the invalid case flags.
    BARE,
    // "use client" after another statement is not the directive.
    'import x from "x";\n"use client";\n' + BARE,
  ],
  invalid: [
    {
      code: CLIENT + BARE,
      errors: [{ messageId: "missingRef" }],
    },
    {
      // Each offending <img> is reported; the ref'd one in between is not.
      code:
        CLIENT +
        "const A = () => <div><img src={a} onError={f} /><img src={b} onError={f} ref={r} /><img src={c} onError={f} /></div>;",
      errors: [
        { messageId: "missingRef", column: 22 },
        { messageId: "missingRef", column: 84 },
      ],
    },
  ],
});
