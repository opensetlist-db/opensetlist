// Detects CSV song rows that would create a second Song for a song that
// already exists under another slug.
//
// The songs CSV import upserts by `slug` only. A catalog scrape that
// derives slugs differently from the hand-entered rows (an English title
// `perennial` vs the romanized `pereniaru`) therefore inserts a brand-new
// Song instead of updating the existing one. Nothing downstream notices:
// both rows are live base songs, so every picker (wishlist, fan board,
// full-setlist prediction) lists the same title twice and fans cannot
// tell which to pick, while the setlist history stays on one row and the
// album track on the other. That is how prod ended up with Song 769 and
// Song 3954 for 「ペレニアル」 (found 2026-10-24).
//
// "Same song" here means: same original title and variant label after
// NFKC + trim + case folding, AND the same set of credited artist slugs.
// The artist condition keeps genuinely different songs that share a
// title (common for short J-POP titles across groups) out of the
// warning. A CSV row without artist_slugs is compared on title+variant
// alone — it carries no artist evidence either way, and a false warning
// is cheaper than a silent duplicate.
//
// This only WARNS. Refusing the row would block the rare legitimate case
// (a same-titled, same-artist re-recording the operator wants as its own
// song before attaching a variantLabel), and the import log is already
// where the operator reads per-row outcomes.

export type ExistingSongForDuplicateCheck = {
  id: bigint;
  slug: string;
  originalTitle: string;
  variantLabel: string | null;
  artistSlugs: string[];
};

export type CsvSongForDuplicateCheck = {
  slug: string;
  originalTitle: string;
  variantLabel: string | null | undefined;
  artistSlugs: string[];
};

/**
 * The comparison form for titles and variant labels: NFKC, trimmed,
 * lower-cased. The import's candidate query mirrors it in SQL
 * (`lower(btrim(normalize(…, NFKC)))`) so both sides agree.
 */
export function normalizeSongText(value: string | null | undefined): string {
  return (value ?? "").normalize("NFKC").trim().toLowerCase();
}

function artistKey(slugs: string[]): string {
  return Array.from(new Set(slugs)).sort().join(" ");
}

/**
 * Existing songs (under a different slug) that the CSV row duplicates.
 * Empty when the row's own slug already exists — that row is an update,
 * not an insert, so it cannot create a duplicate.
 */
export function findDuplicateSongs(
  row: CsvSongForDuplicateCheck,
  existing: ExistingSongForDuplicateCheck[],
  existingSlugs: ReadonlySet<string>,
): ExistingSongForDuplicateCheck[] {
  if (existingSlugs.has(row.slug)) return [];
  const title = normalizeSongText(row.originalTitle);
  const variant = normalizeSongText(row.variantLabel);
  const artists = row.artistSlugs.length > 0 ? artistKey(row.artistSlugs) : null;
  return existing.filter(
    (s) =>
      s.slug !== row.slug &&
      normalizeSongText(s.originalTitle) === title &&
      normalizeSongText(s.variantLabel) === variant &&
      (artists === null || artistKey(s.artistSlugs) === artists),
  );
}
