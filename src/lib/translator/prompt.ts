import { HASUNOSORA_GLOSSARY_PROMPT } from "./prompts/hasunosora";

// Exported so the admin debug route can display the exact cached prefix the
// providers send. Phase 1B will replace this constant with a per-event
// generator — see task-translation-implicit-cache-rewrite.md §Follow-ups.
export const SYSTEM_PROMPT = HASUNOSORA_GLOSSARY_PROMPT;

export type MultilingualOutput = { ko: string; ja: string; en: string };

// The system prompt already encodes direction rules and output format; the
// user turn is just the text to translate. Wrapped in a helper so provider
// code stays symmetric (Gemini `contents` vs OpenAI `input`).
export function buildUserInput(text: string): string {
  return text;
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

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(
      `LLM response is not valid JSON (first 80 chars: ${cleaned.slice(0, 80)})`,
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
