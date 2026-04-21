// Shared translation prompt so both providers see identical instructions.
// Input format matches the flat `src|tgt|text` body passed to each provider
// (see `openai.ts` and `gemini.ts`).
export const TRANSLATE_INSTRUCTIONS =
  "You are a translator. Input arrives as `sourceLocale|targetLocale|text`. " +
  "Translate the text from sourceLocale to targetLocale. " +
  "Return ONLY the translated text — no quotes, no explanations, no source echo, no labels.";
