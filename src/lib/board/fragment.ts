/**
 * URL fragment that selects a board group: `#board-<group slug>`.
 *
 * Slug, not id: it is what a fan sees in a pasted link (the copied
 * picks text appends it), and slugs are ASCII and unique, so no CJK or
 * encoding ever lands in the URL. The fragment matches no element id
 * on purpose — the browser must not jump-scroll on load; the block
 * scrolls itself into view once the board has rendered.
 */
const PREFIX = "#board-";

export function boardFragment(groupSlug: string): string {
  return `${PREFIX}${groupSlug}`;
}

/** The groupId the fragment selects, or null (no/other fragment, or a
 *  slug that isn't one of this board's groups). */
export function groupIdFromFragment(
  hash: string,
  groups: readonly { groupId: string; slug: string }[],
): string | null {
  if (!hash.startsWith(PREFIX)) return null;
  let slug: string;
  try {
    slug = decodeURIComponent(hash.slice(PREFIX.length));
  } catch {
    return null;
  }
  return groups.find((g) => g.slug === slug)?.groupId ?? null;
}
