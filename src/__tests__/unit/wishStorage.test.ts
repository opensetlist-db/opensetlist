import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  readWishes,
  writeWishes,
  type WishEntry,
  type WishSongDisplay,
} from "@/lib/wishStorage";

const SAMPLE_SONG: WishSongDisplay = {
  originalTitle: "残陽",
  originalLanguage: "ja",
  variantLabel: null,
  baseVersionId: null,
  translations: [{ locale: "ko", title: "잔양", variantLabel: null }],
};

function entry(songId: number, dbId: string): WishEntry {
  return { songId, dbId, song: SAMPLE_SONG };
}

beforeEach(() => {
  // jsdom provides window.localStorage; clear between tests.
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("readWishes / writeWishes round-trip", () => {
  it("writes and reads back the same shape", () => {
    const wishes: WishEntry[] = [entry(1, "abc-1"), entry(2, "abc-2")];
    writeWishes("42", wishes);
    expect(readWishes("42")).toEqual(wishes);
  });

  it("returns [] for an unknown eventId", () => {
    expect(readWishes("999")).toEqual([]);
  });

  it("scopes by eventId — reads from one event don't see the other", () => {
    writeWishes("1", [entry(10, "x")]);
    writeWishes("2", [entry(20, "y")]);
    expect(readWishes("1")).toEqual([entry(10, "x")]);
    expect(readWishes("2")).toEqual([entry(20, "y")]);
  });

  it("overwrites a prior write for the same event", () => {
    writeWishes("1", [entry(1, "a")]);
    writeWishes("1", [entry(2, "b")]);
    expect(readWishes("1")).toEqual([entry(2, "b")]);
  });
});

describe("readWishes shape validation", () => {
  it("returns [] for malformed JSON", () => {
    window.localStorage.setItem("wish-1", "not-json{");
    expect(readWishes("1")).toEqual([]);
  });

  it("returns [] for JSON null", () => {
    window.localStorage.setItem("wish-1", "null");
    expect(readWishes("1")).toEqual([]);
  });

  it("returns [] when the stored value lacks the wishes array", () => {
    window.localStorage.setItem("wish-1", JSON.stringify({ other: 123 }));
    expect(readWishes("1")).toEqual([]);
  });

  it("returns [] when wishes is not an array", () => {
    window.localStorage.setItem("wish-1", JSON.stringify({ wishes: "nope" }));
    expect(readWishes("1")).toEqual([]);
  });

  it("returns [] when an entry is missing the song slot", () => {
    window.localStorage.setItem(
      "wish-1",
      JSON.stringify({ wishes: [{ songId: 1, dbId: "x" }] }),
    );
    expect(readWishes("1")).toEqual([]);
  });

  it("returns [] when songId is non-integer / non-positive / NaN / Infinity", () => {
    for (const bad of [0, -1, 1.5, NaN, Infinity, "5", null]) {
      window.localStorage.setItem(
        "wish-1",
        JSON.stringify({
          wishes: [{ songId: bad, dbId: "x", song: SAMPLE_SONG }],
        }),
      );
      expect(readWishes("1")).toEqual([]);
    }
  });

  it("returns [] when dbId is empty string or non-string", () => {
    window.localStorage.setItem(
      "wish-1",
      JSON.stringify({ wishes: [{ songId: 1, dbId: "", song: SAMPLE_SONG }] }),
    );
    expect(readWishes("1")).toEqual([]);
    window.localStorage.setItem(
      "wish-1",
      JSON.stringify({ wishes: [{ songId: 1, dbId: 42, song: SAMPLE_SONG }] }),
    );
    expect(readWishes("1")).toEqual([]);
  });

  it("returns [] when song slot is missing originalTitle", () => {
    window.localStorage.setItem(
      "wish-1",
      JSON.stringify({
        wishes: [
          {
            songId: 1,
            dbId: "x",
            song: {
              originalLanguage: "ja",
              variantLabel: null,
              baseVersionId: null,
              translations: [],
            },
          },
        ],
      }),
    );
    expect(readWishes("1")).toEqual([]);
  });

  it("returns [] when song.translations is not an array", () => {
    window.localStorage.setItem(
      "wish-1",
      JSON.stringify({
        wishes: [
          {
            songId: 1,
            dbId: "x",
            song: { ...SAMPLE_SONG, translations: "not-array" },
          },
        ],
      }),
    );
    expect(readWishes("1")).toEqual([]);
  });

  it("returns [] when even one entry in a multi-entry list is invalid (all-or-nothing)", () => {
    window.localStorage.setItem(
      "wish-1",
      JSON.stringify({
        wishes: [entry(1, "a"), { songId: "not-a-number", dbId: "b" }],
      }),
    );
    expect(readWishes("1")).toEqual([]);
  });
});

describe("writeWishes resilience", () => {
  it("silently swallows quota errors so callers don't see localStorage exceptions", () => {
    vi.spyOn(window.localStorage.__proto__, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError", "QuotaExceededError");
    });
    expect(() => writeWishes("1", [entry(1, "x")])).not.toThrow();
  });
});
