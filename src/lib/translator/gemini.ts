import { GoogleGenAI } from "@google/genai";
import type { Translator } from "./types";
import { TRANSLATE_INSTRUCTIONS } from "./prompt";

export class GeminiTranslator implements Translator {
  private client: GoogleGenAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async translate(
    text: string,
    sourceLocale: string,
    targetLocale: string,
  ): Promise<string> {
    const maxTokens = Math.max(1, Math.round((text.length / 4) * 1.5));
    const response = await this.client.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: `${sourceLocale}|${targetLocale}|${text}`,
      config: {
        systemInstruction: TRANSLATE_INSTRUCTIONS,
        maxOutputTokens: maxTokens,
      },
    });
    const translated = response.text;
    if (!translated) throw new Error("Gemini returned empty translation");
    return translated.trim();
  }
}
