import OpenAI from "openai";
import { TranslationTruncatedError, type Translator } from "./types";
import {
  SYSTEM_PROMPT,
  buildUserInput,
  parseMultilingualResponse,
  type MultilingualOutput,
} from "./prompt";

// Mirror of gemini.ts — see comment there for rationale on the 4.5× factor.
function estimateMaxTokens(text: string): number {
  return Math.max(512, Math.round((text.length / 4) * 4.5));
}

export class OpenAITranslator implements Translator {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async translate(
    text: string,
    sourceLocale: string,
    signal?: AbortSignal,
  ): Promise<MultilingualOutput> {
    const raw = await openaiRawTranslate(this.client, text, sourceLocale, signal);
    return parseMultilingualResponse(raw);
  }
}

// Exposed for the admin debug route — returns the raw pre-parse string.
export async function openaiRawTranslate(
  client: OpenAI,
  text: string,
  sourceLocale: string | undefined,
  signal?: AbortSignal,
): Promise<string> {
  const res = await client.responses.create(
    {
      model: "gpt-4o-mini",
      instructions: SYSTEM_PROMPT,
      input: buildUserInput(text, sourceLocale),
      max_output_tokens: estimateMaxTokens(text),
      // Mirror of gemini.ts: translation is low-creativity, so lower temp
      // keeps output close to the source and reduces phrasing drift.
      temperature: 0.3,
      // The prompt's "JSON 배열로만" line is the primary JSON enforcement.
      // Skip `response_format` here — task notes the current SDK version may
      // not expose it on responses.create; retrofit later if needed.
    },
    signal ? { signal } : undefined,
  );
  if (res.incomplete_details?.reason === "max_output_tokens") {
    throw new TranslationTruncatedError("OpenAI");
  }
  const raw = res.output_text;
  if (!raw) throw new Error("OpenAI returned empty translation");
  return raw;
}
