import type { MultilingualOutput } from "./prompt";

export interface Translator {
  // Returns all three target locales in one call so each request populates
  // both non-source target-cache rows in a single LLM round-trip.
  //
  // `systemPrompt` is required (no default), to force every call site to
  // make a deliberate choice. A silent fallback to a hardcoded default
  // would re-create the pre-multi-IP bug where every event translated
  // against the Hasunosora glossary regardless of franchise.
  //
  // The production route resolves it via promptResolver.resolvePromptForImpression;
  // the admin debug route reads it from IP_PROMPTS / FALLBACK_PROMPT by
  // ipKey (see src/lib/translator/prompts/index.ts).
  //
  // `sourceLocale` is advisory — the prompt itself does not inject it,
  // but the user-turn builder in prompt.ts:buildUserInput uses it as a
  // detection hint.
  translate(
    text: string,
    sourceLocale: string,
    systemPrompt: string,
    signal?: AbortSignal,
  ): Promise<MultilingualOutput>;
}

export class TranslationTruncatedError extends Error {
  constructor(provider: string) {
    super(`${provider} translation truncated at max_output_tokens`);
    this.name = "TranslationTruncatedError";
  }
}
