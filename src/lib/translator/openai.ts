import OpenAI from "openai";
import { TranslationTruncatedError, type Translator } from "./types";
import {
  buildUserInput,
  estimateMaxTokens,
  parseMultilingualResponse,
  type MultilingualOutput,
} from "./prompt";

export class OpenAITranslator implements Translator {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async translate(
    text: string,
    sourceLocale: string,
    systemPrompt: string,
    signal?: AbortSignal,
  ): Promise<MultilingualOutput> {
    const raw = await openaiRawTranslate(
      this.client,
      text,
      sourceLocale,
      systemPrompt,
      signal,
    );
    return parseMultilingualResponse(raw);
  }
}

// Exposed for the admin debug route — returns the raw pre-parse string.
export async function openaiRawTranslate(
  client: OpenAI,
  text: string,
  sourceLocale: string,
  systemPrompt: string,
  signal?: AbortSignal,
): Promise<string> {
  const res = await client.responses.create(
    {
      model: "gpt-4o-mini",
      instructions: systemPrompt,
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
  // Surface abnormal incomplete reasons (content_filter, etc.) instead of
  // squashing into the generic "empty translation" error — symmetric with
  // Gemini's non-STOP finishReason handling.
  const incompleteReason = res.incomplete_details?.reason;
  if (incompleteReason === "max_output_tokens") {
    throw new TranslationTruncatedError("OpenAI");
  }
  if (incompleteReason) {
    throw new Error(
      `OpenAI translation failed: incomplete_reason=${incompleteReason}`,
    );
  }
  const raw = res.output_text;
  if (!raw) throw new Error("OpenAI returned empty translation");
  return raw;
}
