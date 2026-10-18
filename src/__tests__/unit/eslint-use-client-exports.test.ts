// @vitest-environment node
//
// Local ESLint rule `local/use-client-exports` (eslint-rules/): a module
// that starts with "use client" may export components and hooks only.
// A plain value or helper exported from it can resolve to `undefined`
// when a server component imports it (the RSC client-reference
// boundary), which is how `pickTitle` slipped through review in n15-03.
import { describe, it } from "vitest";
import { RuleTester, type Rule } from "eslint";
import tsParser from "@typescript-eslint/parser";
import ruleModule from "../../../eslint-rules/use-client-exports.mjs";

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

tester.run("use-client-exports", rule, {
  valid: [
    // Components and hooks.
    CLIENT + "export function BoardMyPicks() { return null; }",
    CLIENT + "export const FanBoard = () => null;",
    CLIENT + "export function useBoardPicks() {}",
    CLIENT + "export const useThing = () => 1;",
    // Component-shaped initializers stay valid.
    CLIENT + "export const Panel = memo(function Panel() { return null; });",
    CLIENT + "export const Ctx = createContext(null);",
    CLIENT + "export const Box = forwardRef(() => null);",
    CLIENT + "export default function Page() { return null; }",
    CLIENT + "const x = 1; export default x;",
    // Type-only exports are erased at compile time.
    CLIENT + "export type PickFailure = 'network';",
    CLIENT + "export interface Props { a: string }",
    CLIENT + "type T = 1; export type { T };",
    CLIENT + "import type { A } from './a'; export { type A };",
    // Re-exported component / hook names.
    CLIENT + "function Inner() { return null; } export { Inner as Outer };",
    // Not a client module: anything goes.
    "export const BOARD_PICKS_PER_GROUP = 3;",
    "export function pickTitle() { return ''; }",
    // A "use client" string that is not the leading directive.
    "const a = 1;\n'use client';\nexport const x = 1;",
  ],
  invalid: [
    {
      code: CLIENT + "export function pickTitle() { return ''; }",
      errors: [{ messageId: "nonComponent", data: { name: "pickTitle" } }],
    },
    {
      code: CLIENT + "export const BOARD_PICKS_MAX = 3;",
      errors: [{ messageId: "nonComponent", data: { name: "BOARD_PICKS_MAX" } }],
    },
    {
      code: CLIENT + "export const a = 1, Comp = () => null;",
      errors: [{ messageId: "nonComponent", data: { name: "a" } }],
    },
    {
      code: CLIENT + "const helper = () => 1; export { helper };",
      errors: [{ messageId: "nonComponent", data: { name: "helper" } }],
    },
    {
      code: CLIENT + "export class Store {}",
      errors: [{ messageId: "nonComponent", data: { name: "Store" } }],
    },
    {
      code: CLIENT + "export enum Kind { A }",
      errors: [{ messageId: "nonComponent", data: { name: "Kind" } }],
    },
    // A PascalCase name doesn't make a plain value a component.
    {
      code: CLIENT + "export const BoardLimit = 3;",
      errors: [{ messageId: "nonComponent", data: { name: "BoardLimit" } }],
    },
    {
      code: CLIENT + "export const DefaultTheme = { color: 'red' };",
      errors: [{ messageId: "nonComponent", data: { name: "DefaultTheme" } }],
    },
    {
      code: CLIENT + "export const Steps = ['a', 'b'];",
      errors: [{ messageId: "nonComponent", data: { name: "Steps" } }],
    },
    {
      code: CLIENT + "export const Title = `x`, Offset = -1;",
      errors: [
        { messageId: "nonComponent", data: { name: "Title" } },
        { messageId: "nonComponent", data: { name: "Offset" } },
      ],
    },
    {
      code: CLIENT + "export const useLimit = 3;",
      errors: [{ messageId: "nonComponent", data: { name: "useLimit" } }],
    },
    {
      code: CLIENT + "export * from './x';",
      errors: [{ messageId: "exportAll" }],
    },
    {
      code: "'use client'\nexport const { a } = { a: 1 };",
      errors: [{ messageId: "nonComponent", data: { name: "a" } }],
    },
  ],
});
