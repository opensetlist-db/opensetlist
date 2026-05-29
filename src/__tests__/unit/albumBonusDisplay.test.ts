import { describe, it, expect } from "vitest";
import { resolveStoreKey } from "@/lib/albumBonusDisplay";

describe("resolveStoreKey", () => {
  it("maps known stores from free-text names (case / script insensitive)", () => {
    expect(resolveStoreKey("Amazon JP")).toBe("amazon_jp");
    expect(resolveStoreKey("amazon.co.jp")).toBe("amazon_jp");
    expect(resolveStoreKey("楽天ブックス")).toBe("rakuten");
    expect(resolveStoreKey("Rakuten Books")).toBe("rakuten");
    expect(resolveStoreKey("アニメイト")).toBe("animate");
    expect(resolveStoreKey("animate")).toBe("animate");
    expect(resolveStoreKey("タワーレコード")).toBe("tower");
    expect(resolveStoreKey("Tower Records")).toBe("tower");
    expect(resolveStoreKey("HMV&BOOKS")).toBe("hmv");
    expect(resolveStoreKey("ヨドバシカメラ")).toBe("yodobashi");
    expect(resolveStoreKey("ソフマップ")).toBe("sofmap");
    expect(resolveStoreKey("ゲーマーズ")).toBe("gamers");
  });

  it("falls back to 'other' for unmatched, empty, or null names", () => {
    expect(resolveStoreKey("公式ストア")).toBe("other");
    expect(resolveStoreKey("某不明店舗")).toBe("other");
    expect(resolveStoreKey("")).toBe("other");
    expect(resolveStoreKey(null)).toBe("other");
    expect(resolveStoreKey(undefined)).toBe("other");
  });

  it("returns the first matching key (Amazon leads)", () => {
    // A name mentioning two stores resolves to the highest-priority
    // pattern (Amazon before Rakuten), matching STORE_PRIORITY order.
    expect(resolveStoreKey("Amazon / 楽天 併売")).toBe("amazon_jp");
  });
});
