export interface Translator {
  translate(
    text: string,
    sourceLocale: string,
    targetLocale: string,
    signal?: AbortSignal,
  ): Promise<string>;
}

export class TranslationTruncatedError extends Error {
  constructor(provider: string) {
    super(`${provider} translation truncated at max_output_tokens`);
    this.name = "TranslationTruncatedError";
  }
}
