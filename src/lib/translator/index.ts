import { OpenAITranslator } from "./openai";
import { GeminiTranslator } from "./gemini";
import type { Translator } from "./types";

export function getTranslator(): Translator {
  // Prefer VERCEL_ENV because NODE_ENV is "production" on Vercel *preview*
  // deployments too, which would otherwise trick preview into using PROD keys.
  const vercelEnv = process.env.VERCEL_ENV;
  const env = vercelEnv ?? process.env.NODE_ENV;
  const provider = process.env.TRANSLATION_PROVIDER ?? "openai";
  const suffix = env === "production" ? "PROD" : "DEV";

  if (provider === "gemini") {
    const key = process.env[`GEMINI_API_KEY_${suffix}`];
    if (!key) {
      throw new Error(
        `GEMINI_API_KEY_${suffix} not set; required for TRANSLATION_PROVIDER=gemini in ${env}`,
      );
    }
    return new GeminiTranslator(key);
  }

  if (provider === "openai") {
    const key = process.env[`OPENAI_API_KEY_${suffix}`];
    if (!key) {
      throw new Error(
        `OPENAI_API_KEY_${suffix} not set; required for TRANSLATION_PROVIDER=openai in ${env}`,
      );
    }
    return new OpenAITranslator(key);
  }

  throw new Error(`Unknown TRANSLATION_PROVIDER: ${provider}`);
}

export type { Translator };
