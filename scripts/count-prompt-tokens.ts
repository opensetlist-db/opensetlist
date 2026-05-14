/**
 * scripts/count-prompt-tokens.ts
 *
 * One-off verification script. Run locally with GEMINI_API_KEY set:
 *
 *   npx tsx scripts/count-prompt-tokens.ts
 *
 * Iterates every registered IP prompt + FALLBACK_PROMPT, measures the
 * token count on Gemini's tokenizer, and reports pass/fail against the
 * 1024-token implicit-cache threshold. Used after authoring a new prompt
 * file (or editing an existing one) to:
 *   1. Confirm the prompt clears the implicit-cache invariant.
 *   2. Get the exact token count to commit in the file's header comment.
 *
 * Not part of CI (would require a live GEMINI_API_KEY in CI env). The
 * file-header comments are the durable record; this script just re-checks.
 *
 * Background: Gemini 2.5+ and OpenAI prompt caching both require the
 * cached prefix to measure ≥1024 tokens. A silent regression below the
 * threshold breaks caching and 10×'s per-call cost. See
 * task-translation-implicit-cache-rewrite.md §"Token-count invariant".
 */
import { GoogleGenAI } from "@google/genai";
import {
  IP_PROMPTS,
  FALLBACK_PROMPT,
} from "../src/lib/translator/prompts/index";

const MODEL = "gemini-3.1-flash-lite-preview";
const MIN_TOKENS = 1024;

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY not set in env — required for countTokens");
    process.exit(2);
  }
  const client = new GoogleGenAI({ apiKey });

  const entries: Array<[string, string]> = [
    ...Object.entries(IP_PROMPTS).flatMap(([key, prompt]) =>
      prompt ? [[key, prompt] as [string, string]] : [],
    ),
    ["generic (FALLBACK_PROMPT)", FALLBACK_PROMPT],
  ];

  let failed = 0;
  for (const [key, prompt] of entries) {
    const { totalTokens } = await client.models.countTokens({
      model: MODEL,
      contents: prompt,
    });
    const ok = (totalTokens ?? 0) >= MIN_TOKENS;
    if (!ok) failed += 1;
    const status = ok ? "OK " : "FAIL";
    console.log(
      `[${status}] ${key.padEnd(28)} ${totalTokens ?? "?"} tokens  ` +
        `(${prompt.length} chars, ${prompt.split("\n").length} lines)`,
    );
  }

  if (failed > 0) {
    console.error(
      `\n${failed} prompt(s) below the ${MIN_TOKENS}-token implicit-cache threshold. ` +
        `Expand the rules section — do NOT lower the threshold.`,
    );
    process.exit(1);
  }
  console.log(`\nAll prompts ≥ ${MIN_TOKENS} tokens.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
