import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  applyGlossary,
  assemblePairs,
  restoreGlossary,
  type ArtistTerms,
  type GlossaryPair,
} from "@/lib/glossary";

function termsOf(...arr: ArtistTerms["artist"]): ArtistTerms {
  return { artist: arr, stageIdentity: [], realPerson: [], song: [] };
}

describe("assemblePairs", () => {
  it("emits {source, target} for each row with both locales filled", () => {
    const terms = termsOf(
      { ko: "스리부", ja: "スリブ", en: "Cerise Bouquet" },
      { ko: "돌케", ja: "ドルケ", en: "Dollchestra" }
    );
    expect(assemblePairs(terms, "ko", "ja")).toEqual([
      // sorted longest-first by source length (3 == 3, stable order)
      { source: "스리부", target: "スリブ" },
      { source: "돌케", target: "ドルケ" },
    ]);
  });

  it("skips when ko/ja source length < MIN_LEN (2 chars)", () => {
    const terms = termsOf(
      { ko: "츠", ja: "ツ", en: "X" }, // 1 char source — drop
      { ko: "마이", ja: "マイ", en: "Mai" } // 2 chars — keep at MIN_LEN.ko=2
    );
    expect(assemblePairs(terms, "ko", "ja")).toEqual([
      { source: "마이", target: "マイ" },
    ]);
  });

  it("skips when en source length < MIN_LEN.en (4 chars) — higher floor than ko/ja", () => {
    // Short Latin words (Mai, Mio, Hime) collide with common English
    // vocabulary; the per-locale guard pushes en's floor up.
    const terms = termsOf(
      { ko: "마이", ja: "マイ", en: "Mai" }, // en is 3 chars — drop
      { ko: "히메", ja: "姫芽", en: "Hime" }, // en is 4 chars — keep
      { ko: "카호", ja: "花帆", en: "Kaho" } // en is 4 chars — keep
    );
    // en→ko: source "Mai" (3) dropped, sources "Hime"/"Kaho" (4) kept.
    expect(assemblePairs(terms, "en", "ko")).toEqual([
      { source: "Hime", target: "히메" },
      { source: "Kaho", target: "카호" },
    ]);
  });

  it("keeps short target — asymmetric, only source has the min-len guard", () => {
    const terms = termsOf({ ko: "엄", ja: "厳", en: "Strict" });
    // en→ko: source "Strict" (6), target "엄" (1) — kept (target is fine)
    expect(assemblePairs(terms, "en", "ko")).toEqual([
      { source: "Strict", target: "엄" },
    ]);
    // ko→en: source "엄" (1) — dropped (under MIN_LEN.ko=2)
    expect(assemblePairs(terms, "ko", "en")).toEqual([]);
  });

  it("keeps source === target — Latin-script preservation", () => {
    const terms = termsOf({
      ko: "Cerise Bouquet",
      ja: "Cerise Bouquet",
      en: "Cerise Bouquet",
    });
    // Substitution is meaningful — protects substring from LLM rewriting
    expect(assemblePairs(terms, "ko", "ja")).toEqual([
      { source: "Cerise Bouquet", target: "Cerise Bouquet" },
    ]);
    expect(assemblePairs(terms, "en", "ko")).toEqual([
      { source: "Cerise Bouquet", target: "Cerise Bouquet" },
    ]);
  });

  it("sorts by source length descending — longer terms substitute first", () => {
    const terms = termsOf(
      { ko: "마이", ja: "マイ", en: "Mai" },
      { ko: "츠바이 마이", ja: "ツヴァイマイ", en: "Zwei Mai" }
    );
    const pairs = assemblePairs(terms, "ko", "ja");
    expect(pairs.map((p) => p.source)).toEqual(["츠바이 마이", "마이"]);
  });

  it("dedupes by source string — first wins", () => {
    const terms = termsOf(
      { ko: "Kaho", ja: "Kaho", en: "Kaho" },
      { ko: "Kaho", ja: "カホ", en: "Kaho" }
    );
    const pairs = assemblePairs(terms, "ko", "ja");
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toEqual({ source: "Kaho", target: "Kaho" });
  });

  it("skips rows where source or target is empty (post-fallback)", () => {
    const terms = termsOf(
      { ko: "", ja: "ジョー", en: "Jo" }, // missing source
      { ko: "조이", ja: "", en: "Joy" } // missing target
    );
    expect(assemblePairs(terms, "ko", "ja")).toEqual([]);
  });

  it("flattens all 4 categories", () => {
    const terms: ArtistTerms = {
      artist: [{ ko: "AAA", ja: "アア", en: "AAA" }],
      stageIdentity: [{ ko: "BBB", ja: "ビビ", en: "BBB" }],
      realPerson: [{ ko: "CCC", ja: "シシ", en: "CCC" }],
      song: [{ ko: "DDD", ja: "ディディ", en: "DDD" }],
    };
    const pairs = assemblePairs(terms, "ko", "ja");
    expect(pairs.map((p) => p.source).sort()).toEqual([
      "AAA",
      "BBB",
      "CCC",
      "DDD",
    ]);
  });
});

describe("applyGlossary", () => {
  it("empty pairs is a no-op", () => {
    const { processed, restoreMap } = applyGlossary("hello world", []);
    expect(processed).toBe("hello world");
    expect(restoreMap.size).toBe(0);
  });

  it("substitutes pairs in order; restoreMap keys to placeholders", () => {
    const pairs: GlossaryPair[] = [
      { source: "Cerise Bouquet", target: "スリーズブーケ" },
      { source: "Kaho", target: "花帆" },
    ];
    const { processed, restoreMap } = applyGlossary(
      "Cerise Bouquet's Kaho was incredible.",
      pairs
    );
    expect(processed).toBe("__GLOSS_0__'s __GLOSS_1__ was incredible.");
    expect(restoreMap.get("__GLOSS_0__")).toBe("スリーズブーケ");
    expect(restoreMap.get("__GLOSS_1__")).toBe("花帆");
  });

  it("longest-first input prevents shadowing of substring matches", () => {
    // Pairs come from assemblePairs already sorted longest-first
    const pairs: GlossaryPair[] = [
      { source: "츠바이 마이", target: "ツヴァイマイ" },
      { source: "마이", target: "マイ" },
    ];
    const { processed, restoreMap } = applyGlossary(
      "오늘 츠바이 마이 너무 좋았다",
      pairs
    );
    expect(processed).toContain("__GLOSS_0__");
    expect(processed).not.toContain("츠바이");
    // "마이" inside "츠바이 마이" was already absorbed by GLOSS_0,
    // so GLOSS_1 (마이) shouldn't appear in this text.
    expect(processed).not.toContain("__GLOSS_1__");
    expect(restoreMap.get("__GLOSS_0__")).toBe("ツヴァイマイ");
  });

  it("skips pairs that don't appear in the text — no entry in restoreMap", () => {
    const pairs: GlossaryPair[] = [
      { source: "Kaho", target: "花帆" },
      { source: "Sayaka", target: "さやか" },
    ];
    const { processed, restoreMap } = applyGlossary("Kaho was great", pairs);
    expect(processed).toBe("__GLOSS_0__ was great");
    expect(restoreMap.has("__GLOSS_0__")).toBe(true);
    expect(restoreMap.has("__GLOSS_1__")).toBe(false);
  });

  it("source === target still substitutes (preserves through LLM)", () => {
    const pairs: GlossaryPair[] = [
      { source: "DOLLCHESTRA", target: "DOLLCHESTRA" },
    ];
    const { processed, restoreMap } = applyGlossary("DOLLCHESTRA rocks", pairs);
    expect(processed).toBe("__GLOSS_0__ rocks");
    expect(restoreMap.get("__GLOSS_0__")).toBe("DOLLCHESTRA");
  });

  it("ASCII sources only match at word boundaries — protects against substring corruption", () => {
    // At MIN_LEN=2, short Latin sources like "Mai" would otherwise corrupt
    // "mail", "Email", etc. via raw replaceAll. Word-boundary regex prevents this.
    const pairs: GlossaryPair[] = [{ source: "Mai", target: "舞" }];
    const { processed, restoreMap } = applyGlossary(
      "Send Mai an email about her mailbox",
      pairs
    );
    // "Mai" (the standalone word) gets substituted; "email" + "mailbox" untouched.
    expect(processed).toBe("Send __GLOSS_0__ an email about her mailbox");
    expect(restoreMap.get("__GLOSS_0__")).toBe("舞");
  });

  it("ASCII source not in text (no word-boundary match) → no entry in restoreMap", () => {
    const pairs: GlossaryPair[] = [{ source: "Mai", target: "舞" }];
    const { processed, restoreMap } = applyGlossary("just an email here", pairs);
    expect(processed).toBe("just an email here");
    expect(restoreMap.size).toBe(0);
  });

  it("CJK source uses substring (word boundary doesn't apply to CJK)", () => {
    // Per spec §6: \b doesn't fire cleanly on CJK; substring is the practical
    // choice. Korean particles (조사) attaching to a name still hit.
    const pairs: GlossaryPair[] = [{ source: "마이", target: "舞" }];
    const { processed, restoreMap } = applyGlossary("마이가 무대에 올랐다", pairs);
    expect(processed).toBe("__GLOSS_0__가 무대에 올랐다");
    expect(restoreMap.get("__GLOSS_0__")).toBe("舞");
  });

  it("ASCII source with hyphen still matches (hyphen is a word boundary)", () => {
    const pairs: GlossaryPair[] = [
      { source: "Sayo-Shigure", target: "小夜時雨" },
    ];
    const { processed, restoreMap } = applyGlossary(
      "Sayo-Shigure was beautiful",
      pairs
    );
    expect(processed).toBe("__GLOSS_0__ was beautiful");
    expect(restoreMap.get("__GLOSS_0__")).toBe("小夜時雨");
  });

  it("ASCII source with regex meta-characters is escaped before regex use", () => {
    const pairs: GlossaryPair[] = [{ source: "ver.2", target: "버전2" }];
    const { processed, restoreMap } = applyGlossary("ver.2 was the best", pairs);
    expect(processed).toBe("__GLOSS_0__ was the best");
    expect(restoreMap.get("__GLOSS_0__")).toBe("버전2");
  });
});

describe("restoreGlossary", () => {
  it("empty restoreMap returns text unchanged", () => {
    expect(restoreGlossary("hello __GLOSS_0__ world", new Map())).toBe(
      "hello __GLOSS_0__ world"
    );
  });

  it("replaces __GLOSS_N__ tokens with restoreMap values", () => {
    const map = new Map([
      ["__GLOSS_0__", "스리즈 부케"],
      ["__GLOSS_1__", "카호"],
    ]);
    expect(restoreGlossary("__GLOSS_0__의 __GLOSS_1__는 최고였다", map)).toBe(
      "스리즈 부케의 카호는 최고였다"
    );
  });

  it("leaves unknown placeholders intact (defensive)", () => {
    const map = new Map([["__GLOSS_0__", "Foo"]]);
    expect(restoreGlossary("__GLOSS_0__ and __GLOSS_99__", map)).toBe(
      "Foo and __GLOSS_99__"
    );
  });

  it("single-pass: target text containing __GLOSS_N__ literal is safe", () => {
    // If a target value happens to contain a placeholder-shaped string,
    // single-pass replace can't re-trigger and recursively swap it.
    const map = new Map([["__GLOSS_0__", "literal __GLOSS_5__"]]);
    expect(restoreGlossary("prefix __GLOSS_0__ suffix", map)).toBe(
      "prefix literal __GLOSS_5__ suffix"
    );
  });
});

describe("applyGlossary + restoreGlossary round-trip", () => {
  it("preserves substituted text end-to-end", () => {
    const pairs: GlossaryPair[] = [
      { source: "Kaho", target: "花帆" },
      { source: "Sayaka", target: "さやか" },
    ];
    const { processed, restoreMap } = applyGlossary(
      "Kaho and Sayaka performed",
      pairs
    );
    expect(restoreGlossary(processed, restoreMap)).toBe("花帆 and さやか performed");
  });

  it("simulated LLM round-trip — extra translator-introduced text passes through cleanly", () => {
    const pairs: GlossaryPair[] = [{ source: "Hasunosora", target: "蓮ノ空" }];
    const { processed, restoreMap } = applyGlossary("I love Hasunosora", pairs);
    // Simulate translator output (Korean translation with placeholder intact)
    const llmOutput = `나는 ${processed.replace("I love ", "")}를 사랑합니다`;
    // i.e., "나는 __GLOSS_0__를 사랑합니다"
    expect(restoreGlossary(llmOutput, restoreMap)).toBe("나는 蓮ノ空를 사랑합니다");
  });
});

describe("getArtistTerms cache", () => {
  beforeEach(async () => {
    const mod = await import("@/lib/glossary");
    mod._resetGlossaryCacheForTests();
    vi.resetAllMocks();
  });

  it("second call within TTL returns cached data without re-querying", async () => {
    const fakeNow = 1_700_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(fakeNow);

    const { prisma } = await import("@/lib/prisma");
    const mod = await import("@/lib/glossary");

    const findUnique = vi
      .spyOn(prisma.artist, "findUnique")
      .mockResolvedValue(null);
    vi.spyOn(prisma.stageIdentity, "findMany").mockResolvedValue([]);
    vi.spyOn(prisma.song, "findMany").mockResolvedValue([]);

    await mod.getArtistTerms(BigInt(42));
    expect(findUnique).toHaveBeenCalledTimes(1);

    // Advance 30 minutes — still within 1h TTL
    vi.setSystemTime(fakeNow + 30 * 60 * 1000);
    await mod.getArtistTerms(BigInt(42));
    expect(findUnique).toHaveBeenCalledTimes(1); // no re-query

    vi.useRealTimers();
  });

  it("call after TTL re-hits the DB", async () => {
    const fakeNow = 1_700_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(fakeNow);

    const { prisma } = await import("@/lib/prisma");
    const mod = await import("@/lib/glossary");

    const findUnique = vi
      .spyOn(prisma.artist, "findUnique")
      .mockResolvedValue(null);
    vi.spyOn(prisma.stageIdentity, "findMany").mockResolvedValue([]);
    vi.spyOn(prisma.song, "findMany").mockResolvedValue([]);

    await mod.getArtistTerms(BigInt(42));
    expect(findUnique).toHaveBeenCalledTimes(1);

    // Advance 1h + 1ms — past TTL
    vi.setSystemTime(fakeNow + 60 * 60 * 1000 + 1);
    await mod.getArtistTerms(BigInt(42));
    expect(findUnique).toHaveBeenCalledTimes(2); // re-queried

    vi.useRealTimers();
  });
});
