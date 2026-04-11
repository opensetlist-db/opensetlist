import { describe, it, expect } from "vitest";
import { getPerformers, isUnitSong } from "@/lib/performers";

const makeSI = (id: string, name: string) => ({
  id,
  translations: [{ locale: "ja", name, shortName: null }],
});

const kaho = makeSI("si-kaho", "日野下花帆");
const sayaka = makeSI("si-sayaka", "村野さやか");
const rurino = makeSI("si-rurino", "大沢瑠璃乃");
const ginko = makeSI("si-ginko", "百生吟子");
const seras = makeSI("si-seras", "セラス柳田リリエンフェルト");

const eventPerformers = [
  { isGuest: false, stageIdentity: kaho },
  { isGuest: false, stageIdentity: sayaka },
  { isGuest: false, stageIdentity: rurino },
  { isGuest: false, stageIdentity: ginko },
  { isGuest: true, stageIdentity: seras },
];

describe("isUnitSong", () => {
  it("returns true when artist has parentArtistId", () => {
    const item = {
      performers: [],
      artists: [{ artist: { parentArtistId: BigInt(1) } }],
    };
    expect(isUnitSong(item)).toBe(true);
  });

  it("returns false when artist has no parentArtistId (top-level group)", () => {
    const item = {
      performers: [],
      artists: [{ artist: { parentArtistId: null } }],
    };
    expect(isUnitSong(item)).toBe(false);
  });

  it("returns false when no artists", () => {
    const item = { performers: [], artists: [] };
    expect(isUnitSong(item)).toBe(false);
  });
});

describe("getPerformers", () => {
  it("returns explicit performers for unit songs", () => {
    const item = {
      performers: [{ stageIdentity: kaho }, { stageIdentity: ginko }],
      artists: [{ artist: { parentArtistId: BigInt(1) } }],
    };
    const result = getPerformers(item, eventPerformers);
    expect(result).toEqual([kaho, ginko]);
  });

  it("returns explicit performers for full group songs when filled", () => {
    // Special case: guest joins full group song (explicitly entered)
    const item = {
      performers: [
        { stageIdentity: kaho },
        { stageIdentity: sayaka },
        { stageIdentity: seras },
      ],
      artists: [{ artist: { parentArtistId: null } }],
    };
    const result = getPerformers(item, eventPerformers);
    expect(result).toEqual([kaho, sayaka, seras]);
  });

  it("falls back to event regular performers for full group songs when empty", () => {
    const item = {
      performers: [],
      artists: [{ artist: { parentArtistId: null } }],
    };
    const result = getPerformers(item, eventPerformers);
    // Should exclude guest (seras)
    expect(result).toEqual([kaho, sayaka, rurino, ginko]);
    expect(result).not.toContainEqual(seras);
  });

  it("returns empty for unit songs with no explicit performers", () => {
    const item = {
      performers: [],
      artists: [{ artist: { parentArtistId: BigInt(1) } }],
    };
    const result = getPerformers(item, eventPerformers);
    expect(result).toEqual([]);
  });
});
