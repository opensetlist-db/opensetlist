import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { TranslationTruncatedError, type Translator } from "./types";
import {
  SYSTEM_PROMPT,
  buildUserInput,
  parseMultilingualResponse,
  type MultilingualOutput,
} from "./prompt";

// Three-language JSON output ≈ 3× source length + brace/quote overhead. Floor
// of 512 catches short inputs; the 4.5× factor is the "rough floor" from the
// task spec and leaves headroom for edited impressions.
function estimateMaxTokens(text: string): number {
  return Math.max(512, Math.round((text.length / 4) * 4.5));
}

export class GeminiTranslator implements Translator {
  private client: GoogleGenAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async translate(
    text: string,
    sourceLocale: string,
    signal?: AbortSignal,
  ): Promise<MultilingualOutput> {
    const raw = await geminiRawTranslate(this.client, text, sourceLocale, signal);
    return parseMultilingualResponse(raw);
  }
}

// Exposed for the admin debug route — returns the raw pre-parse string so the
// UI can show the LLM's literal output alongside the parsed breakdown.
export async function geminiRawTranslate(
  client: GoogleGenAI,
  text: string,
  sourceLocale: string,
  signal?: AbortSignal,
): Promise<string> {
  const response = await client.models.generateContent({
    model: "gemini-3.1-flash-lite-preview",
    contents: buildUserInput(text, sourceLocale),
    config: {
      systemInstruction: SYSTEM_PROMPT,
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
