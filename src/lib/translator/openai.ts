import OpenAI from "openai";
import type { Translator } from "./types";
import { TRANSLATE_INSTRUCTIONS } from "./prompt";

export class OpenAITranslator implements Translator {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async translate(
    text: string,
    sourceLocale: string,
    targetLocale: string,
  ): Promise<string> {
    const maxTokens = Math.max(1, Math.round((text.length / 4) * 1.5));
    const res = await this.client.responses.create({
      model: "gpt-4o-mini",
      instructions: TRANSLATE_INSTRUCTIONS,
      input: `${sourceLocale}|${targetLocale}|${text}`,
      max_output_tokens: maxTokens,
    });
    const translated = res.output_text;
    if (!translated) throw new Error("OpenAI returned empty translation");
    return translated.trim();
  }
}
