import { GoogleGenAI } from "@google/genai";
import type { Translator } from "./types";

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
    const maxTokens = Math.round((text.length / 4) * 1.5);
    const response = await this.client.models.generateContent({
      model: "gemini-3.1-flash-lite",
      contents: `${sourceLocale}|${targetLocale}|${text}`,
      config: { maxOutputTokens: maxTokens },
    });
    const translated = response.text;
    if (!translated) throw new Error("Gemini returned empty translation");
    return translated.trim();
  }
}
