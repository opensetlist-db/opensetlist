/*
 * Shared layout constants for the desktop artists-list table.
 * GroupSection's column-header row and ArtistTableRow's data rows
 * must use the same `gridTemplateColumns` value or the columns
 * misalign vertically. Pulled into one place so adding/widening a
 * column is a single edit instead of a grep-and-replace across the
 * two siblings.
 *
 * Tracks: 56px avatar | 1fr name+ja | 1fr subunit chips |
 *         80px event count | 28px chevron.
 */
export const ARTIST_TABLE_COLUMNS = "56px 1fr 1fr 80px 28px";
