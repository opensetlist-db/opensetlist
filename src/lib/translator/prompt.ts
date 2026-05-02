import { HASUNOSORA_GLOSSARY_PROMPT } from "./prompts/hasunosora";

// Exported so the admin debug route can display the exact cached prefix the
// providers send. Phase 1B will replace this constant with a per-event
// generator — see task-translation-implicit-cache-rewrite.md §Follow-ups.
export const SYSTEM_PROMPT = HASUNOSORA_GLOSSARY_PROMPT;

export type MultilingualOutput = { ko: string; ja: string; en: string };

// The system prompt is a glossary first and a translation instruction
// second — section [1] (고유명사 사전) consumes ~95% of its 1073 tokens.
// On long inputs that mention dictionary entries the framing is anchored
// and the model translates idiomatically. On inputs with zero glossary
// matches (e.g. a generic Korean verb like `시작한다`), the model's
// interpretation can flip to "extract glossary entries" and emit `[]`,
// which the parser correctly rejects → 502 to the user (F13, 2026-05-02).
//
// We can't edit the system prompt to clarify the task — its >1024 token
// count is the implicit-cache invariant (see prompts/hasunosora.ts).
// Instead, we disambiguate on the user turn, which is NOT cached, so we
// can spend tokens here freely without perturbing cache hits:
//   1. `source_locale:` line — the original hint. Latin-script titles and
//      short strings that exist verbatim across ko/ja/en are hard for the
//      model to detect on content alone; without the hint the source row
//      can get rewritten or the non-source rows drift.
//   2. `task:` line — names the operation explicitly ("translate ...
//      into ko, ja, and en") and pins the output shape ("Always return
//      one JSON object inside an array ... even when the text contains
//      no glossary entries"). The always-array clause is the load-bearing
//      part: it tells the model that `[]` is never a valid response.
//   3. `text:` label — separates the task framing from user content so
//      the model can't read the `task:` clause as part of the input.
export function buildUserInput(text: string, sourceLocale: string): string {
  return (
    `source_locale: ${sourceLocale}\n` +
    `task: translate the impression text below into ko, ja, and en. ` +
    `Always return one JSON object inside an array per the format rule, ` +
    `even when the text contains no glossary entries.\n` +
    `text:\n${text}`
  );
}

// Three-language JSON output ≈ 3× source length + brace/quote overhead.
// Floor of 512 catches short inputs; 4.5× is the "rough floor" from the
// task spec and leaves headroom for edited impressions. Shared across
// providers so the maxTokens budget stays in sync.
export function estimateMaxTokens(text: string): number {
  return Math.max(512, Math.round((text.length / 4) * 4.5));
}

// LLMs occasionally wrap JSON in ```json fences or prepend prose despite the
// "JSON 배열로만" instruction. Strip that, then parse. Tolerates both a bare
// object and a single-element array (the prompt asks for array, but models
// sometimes emit a naked object).
export function parseMultilingualResponse(raw: string): MultilingualOutput {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  // Tolerate leading prose like "Sure, here's the JSON: [...]" by slicing
  // to the first JSON start token. Gemini's responseMimeType + the
  // "JSON 배열로만" instruction already make this rare; belt-and-suspenders
  // for OpenAI (no equivalent API-level enforcement).
  const firstTokenIdx = cleaned.search(/[{[]/);
  const jsonSlice = firstTokenIdx >= 0 ? cleaned.slice(firstTokenIdx) : cleaned;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonSlice);
  } catch {
    throw new Error(
      `LLM response is not valid JSON (first 80 chars: ${jsonSlice.slice(0, 80)})`,
    );
  }

  const entry = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!entry || typeof entry !== "object") {
    throw new Error("LLM response has no object entry");
  }
  const obj = entry as Record<string, unknown>;

  const out: MultilingualOutput = {
    ko: typeof obj.ko === "string" ? obj.ko.trim() : "",
    ja: typeof obj.ja === "string" ? obj.ja.trim() : "",
    en: typeof obj.en === "string" ? obj.en.trim() : "",
  };

  if (!out.ko && !out.ja && !out.en) {
    throw new Error("LLM response has no locale values");
  }
  return out;
}
