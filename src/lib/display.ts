/**
 * Returns shortName if available, falls back to name.
 * Use 'full' mode for SEO meta tags and page H1 titles.
 * Use 'short' mode (default) everywhere else.
 */
export function displayName(
  translation: { name: string; shortName?: string | null },
  mode: "short" | "full" = "short"
): string {
  if (mode === "short") {
    return translation.shortName ?? translation.name;
  }
  return translation.name;
}
