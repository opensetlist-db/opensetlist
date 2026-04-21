import OpenAI from "openai";
import { TranslationTruncatedError, type Translator } from "./types";
import { TRANSLATE_INSTRUCTIONS, buildTranslationInput } from "./prompt";

export class OpenAITranslator implements Translator {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async translate(
    text: string,
    sourceLocale: string,
    targetLocale: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const maxTokens = Math.max(256, Math.round((text.length / 4) * 1.5));
    const res = await this.client.responses.create(
      {
        model: "gpt-4o-mini",
        instructions: TRANSLATE_INSTRUCTIONS,
        input: buildTranslationInput(sourceLocale, targetLocale, text),
        max_output_tokens: maxTokens,
      },
      signal ? { signal } : undefined,
    );
    if (res.incomplete_details?.reason === "max_output_tokens") {
      throw new TranslationTruncatedError("OpenAI");
    }
    const translated = res.output_text;
    if (!translated) throw new Error("OpenAI returned empty translation");
    return translated.trim();
  }
}
