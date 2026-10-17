/**
 * scripts/count-prompt-tokens.ts
 *
 * One-off verification script. Run locally with GEMINI_API_KEY and/or
 * ANTHROPIC_API_KEY set:
 *
 *   npx tsx scripts/count-prompt-tokens.ts
 *
 * Iterates every registered IP prompt + FALLBACK_PROMPT, measures the
 * token count on each tokenizer whose key is present, and reports
 * pass/fail against that provider's cache threshold:
 *   - Gemini: 1024 tokens (implicit cache; OpenAI shares the threshold
 *     but has no public count endpoint, so Gemini stands in for it)
 *   - Claude (ANTHROPIC_MODEL): 512 tokens, the minimum cacheable prefix
 *     for Haiku 5.5
 * A provider whose key is missing is skipped, not failed.
 *
 * Used after authoring a new prompt file (or editing an existing one) to:
 *   1. Confirm the prompt clears every provider's cache threshold.
 *   2. Get the exact token count to commit in the file's header comment.
 *
 * Not part of CI (would require live API keys in CI env). The
 * file-header comments are the durable record; this script just re-checks.
 *
 * Background: Gemini 2.5+ and OpenAI prompt caching both require the
 * cached prefix to measure ≥1024 tokens. A silent regression below the
 * threshold breaks caching and 10×'s per-call cost. See
 * task-translation-implicit-cache-rewrite.md §"Token-count invariant".
 */
import { GoogleGenAI } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
import {
  IP_PROMPTS,
  FALLBACK_PROMPT,
} from "../src/lib/translator/prompts/index";
import { GEMINI_MODEL } from "../src/lib/translator/gemini";
import { ANTHROPIC_MODEL } from "../src/lib/translator/anthropic";

type Counter = {
  name: string;
  minTokens: number;
  count: (prompt: string) => Promise<number | undefined>;
};

function buildCounters(): Counter[] {
  const counters: Counter[] = [];

  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    const client = new GoogleGenAI({ apiKey: geminiKey });
    counters.push({
      name: `Gemini ${GEMINI_MODEL}`,
      minTokens: 1024,
      count: async (prompt) =>
        (
          await client.models.countTokens({
            model: GEMINI_MODEL,
            contents: prompt,
          })
        ).totalTokens,
    });
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    const client = new Anthropic({ apiKey: anthropicKey });
    // countTokens requires a non-empty messages array, so every count
    // includes a placeholder user turn. Subtracting a baseline measured
    // with the same turn and no system prompt leaves the system prompt
    // alone — the cached prefix the 512-token minimum applies to.
    // Without this, a prompt just under 512 could pass on the strength of
    // the placeholder's tokens.
    const messages = [{ role: "user" as const, content: "." }];
    let baseline: number | undefined;
    counters.push({
      name: `Claude ${ANTHROPIC_MODEL}`,
      minTokens: 512,
      count: async (prompt) => {
        baseline ??= (
          await client.messages.countTokens({ model: ANTHROPIC_MODEL, messages })
        ).input_tokens;
        const total = (
          await client.messages.countTokens({
            model: ANTHROPIC_MODEL,
            system: prompt,
            messages,
          })
        ).input_tokens;
        return total - baseline;
      },
    });
  }

  return counters;
}

async function main() {
  const counters = buildCounters();
  if (counters.length === 0) {
    console.error(
      "Neither GEMINI_API_KEY nor ANTHROPIC_API_KEY is set — nothing to measure",
    );
    process.exit(2);
  }

  const entries: Array<[string, string]> = [
    ...Object.entries(IP_PROMPTS).flatMap(([key, prompt]) =>
      prompt ? [[key, prompt] as [string, string]] : [],
    ),
    ["generic (FALLBACK_PROMPT)", FALLBACK_PROMPT],
  ];

  let failed = 0;
  for (const counter of counters) {
    console.log(`\n${counter.name} (cache threshold ${counter.minTokens})`);
    for (const [key, prompt] of entries) {
      const tokens = await counter.count(prompt);
      const ok = (tokens ?? 0) >= counter.minTokens;
      if (!ok) failed += 1;
      const status = ok ? "OK " : "FAIL";
      console.log(
        `[${status}] ${key.padEnd(28)} ${tokens ?? "?"} tokens  ` +
          `(${prompt.length} chars, ${prompt.split("\n").length} lines)`,
      );
    }
  }

  if (failed > 0) {
    console.error(
      `\n${failed} measurement(s) below the provider's cache threshold. ` +
        `Expand the rules section — do NOT lower the threshold.`,
    );
    process.exit(1);
  }
  console.log(`\nAll prompts clear every measured threshold.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
