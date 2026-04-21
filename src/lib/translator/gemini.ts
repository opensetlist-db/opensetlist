import { GoogleGenAI } from "@google/genai";
import { TranslationTruncatedError, type Translator } from "./types";
import { TRANSLATE_INSTRUCTIONS, buildTranslationInput } from "./prompt";

export class GeminiTranslator implements Translator {
  private client: GoogleGenAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async translate(
    text: string,
    sourceLocale: string,
    targetLocale: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const maxTokens = Math.max(256, Math.round((text.length / 4) * 1.5));
    const response = await this.client.models.generateContent({
      model: "gemini-3.1-flash-lite-preview",
      contents: buildTranslationInput(sourceLocale, targetLocale, text),
      config: {
        systemInstruction: TRANSLATE_INSTRUCTIONS,
        maxOutputTokens: maxTokens,
        ...(signal ? { abortSignal: signal } : {}),
      },
    });
    if (response.candidates?.[0]?.finishReason === "MAX_TOKENS") {
      throw new TranslationTruncatedError("Gemini");
    }
    const translated = response.text;
    if (!translated) throw new Error("Gemini returned empty translation");
    return translated.trim();
  }
}
