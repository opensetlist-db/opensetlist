import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { TranslationTruncatedError, type Translator } from "./types";
import {
  buildUserInput,
  estimateMaxTokens,
  parseMultilingualResponse,
  type MultilingualOutput,
} from "./prompt";

// Single source of truth for the Gemini model used by both the live
// translator call and the offline token-count verification script
// (scripts/count-prompt-tokens.ts). Bumping the model in one place
// without the other would silently measure tokens against the wrong
// tokenizer.
export const GEMINI_MODEL = "gemini-3.1-flash-lite-preview";

export class GeminiTranslator implements Translator {
  private client: GoogleGenAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async translate(
    text: string,
    sourceLocale: string,
    systemPrompt: string,
    signal?: AbortSignal,
  ): Promise<MultilingualOutput> {
    const raw = await geminiRawTranslate(
      this.client,
      text,
      sourceLocale,
      systemPrompt,
      signal,
    );
    return parseMultilingualResponse(raw);
  }
}

// Exposed for the admin debug route — returns the raw pre-parse string so the
// UI can show the LLM's literal output alongside the parsed breakdown.
export async function geminiRawTranslate(
  client: GoogleGenAI,
  text: string,
  sourceLocale: string,
  systemPrompt: string,
  signal?: AbortSignal,
): Promise<string> {
  const response = await client.models.generateContent({
    model: GEMINI_MODEL,
    contents: buildUserInput(text, sourceLocale),
    config: {
      systemInstruction: systemPrompt,
      maxOutputTokens: estimateMaxTokens(text),
      // Translation is low-creativity; low temperature keeps output close
      // to a direct reading of the source and reduces phrasing drift on
      // retries (also more cache-friendly at the token level).
      temperature: 0.3,
      // Gemini 3.x flash defaults to reasoning mode; translation is
      // low-reasoning, so minimal thinking cuts latency and avoids burning
      // thinking-tokens we don't need.
      thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
      // Belt-and-suspenders JSON enforcement — the prompt already says
      // "JSON 배열로만", but this binds the output format at the API layer.
      // Drop the field if a preview model rejects it.
      responseMimeType: "application/json",
      ...(signal ? { abortSignal: signal } : {}),
    },
  });
  // Surface non-STOP finish reasons (SAFETY / RECITATION / OTHER / ...) so
  // safety-block failures don't get tarred with the generic
  // "empty translation" message — retry / debugging depends on seeing the
  // actual reason.
  const finishReason = response.candidates?.[0]?.finishReason;
  if (finishReason === "MAX_TOKENS") {
    throw new TranslationTruncatedError("Gemini");
  }
  if (finishReason && finishReason !== "STOP") {
    throw new Error(`Gemini translation failed: finishReason=${finishReason}`);
  }
  const raw = response.text;
  if (!raw) throw new Error("Gemini returned empty translation");
  return raw;
}
