/**
 * Generates a URL/import slug from a name string.
 * For Japanese/Korean names, always provide explicit slug in CSV
 * rather than relying on auto-generation (non-ASCII stripped).
 */
export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
}
