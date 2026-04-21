export interface Translator {
  translate(
    text: string,
    sourceLocale: string,
    targetLocale: string,
  ): Promise<string>;
}
