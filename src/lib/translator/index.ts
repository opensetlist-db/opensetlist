import { OpenAITranslator } from "./openai";
import { GeminiTranslator } from "./gemini";
import type { Translator } from "./types";

export function getTranslator(): Translator {
  const provider = process.env.TRANSLATION_PROVIDER ?? "gemini";

  if (provider === "gemini") {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error(
        "GEMINI_API_KEY not set; required for TRANSLATION_PROVIDER=gemini",
      );
    }
    return new GeminiTranslator(key);
  }

  if (provider === "openai") {
    const key = process.env.OPENAI_API_KEY;
    if (!key) {
      throw new Error(
        "OPENAI_API_KEY not set; required for TRANSLATION_PROVIDER=openai",
      );
    }
    return new OpenAITranslator(key);
  }

  throw new Error(`Unknown TRANSLATION_PROVIDER: ${provider}`);
}

export type { Translator };
