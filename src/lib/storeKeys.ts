export const STORE_REGEXES: ReadonlyArray<readonly [RegExp, string]> = [
  [/amazon|アマゾン/i, "amazon_jp"],
  [/楽天|rakuten/i, "rakuten"],
  [/アニメイト|animate/i, "animate"],
  [/タワー|tower\s*records?/i, "tower"],
  [/HMV/i, "hmv"],
  [/ヨドバシ|yodobashi/i, "yodobashi"],
  [/ソフマップ|sofmap/i, "sofmap"],
  [/ゲーマーズ|gamers/i, "gamers"],
];

export function resolveStoreKey(storeName: string | null | undefined): string {
  if (!storeName) return "other";
  for (const [pattern, key] of STORE_REGEXES) {
    if (pattern.test(storeName)) return key;
  }
  return "other";
}

export function officialStoreKey(storeName: string) {
  const normalized = storeName.normalize("NFKC").trim().toLowerCase();
  const known = resolveStoreKey(normalized);
  return known === "other" ? normalized : known;
}
