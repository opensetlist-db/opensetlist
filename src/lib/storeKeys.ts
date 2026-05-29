/*
 * Single source of truth for identifying a store from the free-text
 * `AlbumStoreListing.originalStoreName` (operator types "Amazon JP" /
 * "amazon_jp" / "アマゾン" freely — see the schema comment). Two
 * consumers derive from this one ordered list:
 *
 *   - `resolveStoreKey` (src/lib/albumBonusDisplay.ts) → the canonical
 *     analytics key for the b10c `store_click` event + the album page's
 *     `has_amazon_listing` flag.
 *   - `STORE_PRIORITY` (src/lib/eventBdState.ts) → the bonus-preview
 *     sort order in `selectTopBonuses`.
 *
 * Deriving both off this single array means adding a store updates the
 * analytics key AND the preview sort rank together — they can't silently
 * drift apart (the failure mode: a click counted under the wrong/`other`
 * key while the BD preview still ranks it, or vice versa).
 *
 * Order IS priority: affiliate-revenue stores (Amazon, Rakuten) lead so
 * they win the limited bonus-preview slots; first regex to match wins.
 */
export const STORE_REGEXES: ReadonlyArray<readonly [RegExp, string]> = [
  [/amazon/i, "amazon_jp"],
  [/楽天|rakuten/i, "rakuten"],
  [/アニメイト|animate/i, "animate"],
  [/タワー|tower\s*record/i, "tower"],
  [/HMV/i, "hmv"],
  [/ヨドバシ|yodobashi/i, "yodobashi"],
  [/ソフマップ|sofmap/i, "sofmap"],
  [/ゲーマーズ|gamers/i, "gamers"],
];
