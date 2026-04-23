import type { MultilingualOutput } from "./prompt";

export interface Translator {
  // Returns all three target locales in one call so each request populates
  // both non-source target-cache rows in a single LLM round-trip. The
  // hardcoded Hasunosora prompt encodes direction rules inline, so
  // `sourceLocale` is advisory for Phase 1A; retained in the signature for
  // Phase 1B per-event prompts that may want it.
  translate(
    text: string,
    sourceLocale: string,
    signal?: AbortSignal,
  ): Promise<MultilingualOutput>;
}

export class TranslationTruncatedError extends Error {
  constructor(provider: string) {
    super(`${provider} translation truncated at max_output_tokens`);
    this.name = "TranslationTruncatedError";
  }
}
