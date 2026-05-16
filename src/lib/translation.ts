/**
 * Whether to show the "번역보기" button for a comment.
 * Returns false if the comment's detected locale is in the user's known locales.
 */
export function shouldShowTranslateButton(
  detectedLocale: string | null | undefined,
  knownLocales: string[]
): boolean {
  if (!detectedLocale) return false;
  return !knownLocales.includes(detectedLocale);
}
