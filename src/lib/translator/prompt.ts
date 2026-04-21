// Shared translation prompt so both providers see identical instructions.
// Input is a JSON object — not a delimited string — because impression text
// is user-generated and can contain any character (pipes, newlines, quotes).
export const TRANSLATE_INSTRUCTIONS =
  "You are a translator. Input arrives as a JSON object with keys " +
  "`sourceLocale`, `targetLocale`, and `text`. " +
  "Translate `text` from sourceLocale to targetLocale. " +
  "Return ONLY the translated text — no quotes, no explanations, no source echo, no labels, no JSON wrapping.";

export function buildTranslationInput(
  sourceLocale: string,
  targetLocale: string,
  text: string,
): string {
  return JSON.stringify({ sourceLocale, targetLocale, text });
}
