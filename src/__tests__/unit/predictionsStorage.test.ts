import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  hasPredictions,
  predictKey,
  readPredictions,
  readPredictionEntries,
  writePredictions,
  markLocked,
  clearPredictions,
  type PredictionEntry,
} from "@/lib/predictionsStorage";
import type { WishSongDisplay } from "@/lib/wishStorage";

const SAMPLE_SONG: WishSongDisplay = {
  originalTitle: "残陽",
  originalLanguage: "ja",
  variantLabel: null,
  baseVersionId: null,
  translations: [{ locale: "ko", title: "잔양", variantLabel: null }],
};

function entry(songId: number): PredictionEntry {
  return { songId, song: SAMPLE_SONG };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("predictKey", () => {
  it("namespaces by eventId", () => {
    expect(predictKey("42")).toBe("predict-42");
    expect(predictKey("123")).toBe("predict-123");
  });
});

describe("hasPredictions", () => {
  it("returns false when no value is stored", () => {
    expect(hasPredictions("1")).toBe(false);
  });

  it("returns true when valid JSON is stored", () => {
    window.localStorage.setItem("predict-1", JSON.stringify({ slots: [] }));
    expect(hasPredictions("1")).toBe(true);
  });

  it("returns true even for an empty array payload (any valid JSON counts)", () => {
    // Tab visibility is intentionally permissive — Stage C tightens
    // the shape contract. An empty-but-present payload still means
    // "the user opened the prediction surface" and the tab should
    // show.
    window.localStorage.setItem("predict-1", JSON.stringify([]));
    expect(hasPredictions("1")).toBe(true);
  });

  it("returns false on malformed JSON (no crash)", () => {
    window.localStorage.setItem("predict-1", "not-json{");
    expect(hasPredictions("1")).toBe(false);
  });

  it("scopes by eventId — predictions for one event don't leak to another", () => {
    window.localStorage.setItem("predict-1", JSON.stringify({ x: 1 }));
    expect(hasPredictions("1")).toBe(true);
    expect(hasPredictions("2")).toBe(false);
  });
});

describe("readPredictions / writePredictions round-trip", () => {
  it("writes and reads back the same shape", () => {
    writePredictions("42", [entry(1), entry(2)]);
    const stored = readPredictions("42");
    expect(stored).not.toBeNull();
    expect(stored!.eventId).toBe("42");
    expect(stored!.songs).toEqual([entry(1), entry(2)]);
    expect(typeof stored!.savedAt).toBe("string");
    expect(stored!.lockedAt).toBeNull();
  });

  it("preserves lockedAt across subsequent writes", () => {
    writePredictions("1", [entry(1)]);
    markLocked("1", new Date("2026-05-23T12:00:00Z"));
    // A later write (e.g. user adds a song after lock — UI should
    // prevent this but the storage layer doesn't enforce) preserves
    // the lock instant rather than clobbering it.
    writePredictions("1", [entry(1), entry(2)]);
    const stored = readPredictions("1");
    expect(stored!.lockedAt).toBe("2026-05-23T12:00:00.000Z");
    expect(stored!.songs).toHaveLength(2);
  });

  it("returns null for an unknown eventId", () => {
    expect(readPredictions("999")).toBeNull();
  });

  it("returns null when stored eventId mismatches the requested eventId", () => {
    // Defensive against manual localStorage edits.
    writePredictions("1", [entry(1)]);
    // Tamper: copy the value to a different key.
    const raw = window.localStorage.getItem("predict-1")!;
    window.localStorage.setItem("predict-2", raw);
    // predict-2 contains eventId="1" — readPredictions("2") rejects.
    expect(readPredictions("2")).toBeNull();
  });
});

describe("readPredictionEntries", () => {
  it("returns the songs array directly", () => {
    writePredictions("1", [entry(10), entry(20)]);
    expect(readPredictionEntries("1")).toEqual([entry(10), entry(20)]);
  });

  it("returns fresh [] per call when no value is stored", () => {
    const a = readPredictionEntries("1");
    const b = readPredictionEntries("1");
    expect(a).toEqual([]);
    expect(b).toEqual([]);
    // Mutating a[] must not affect b[] — guards against the
    // shared-mutable-EMPTY trap PR #279 fixed in wishStorage.
    a.push({ songId: 999, song: SAMPLE_SONG });
    expect(b).toEqual([]);
  });
});

describe("readPredictions shape validation", () => {
  it("returns null on malformed JSON", () => {
    window.localStorage.setItem("predict-1", "not-json{");
    expect(readPredictions("1")).toBeNull();
  });

  it("returns null when songs array contains a malformed entry", () => {
    window.localStorage.setItem(
      "predict-1",
      JSON.stringify({
        eventId: "1",
        songs: [entry(1), { songId: "not-a-number", song: SAMPLE_SONG }],
        savedAt: new Date().toISOString(),
        lockedAt: null,
      }),
    );
    expect(readPredictions("1")).toBeNull();
  });

  it("returns null when eventId is missing", () => {
    window.localStorage.setItem(
      "predict-1",
      JSON.stringify({
        songs: [entry(1)],
        savedAt: new Date().toISOString(),
        lockedAt: null,
      }),
    );
    expect(readPredictions("1")).toBeNull();
  });
});

describe("markLocked", () => {
  it("stamps lockedAt the first time it's called", () => {
    writePredictions("1", [entry(1)]);
    markLocked("1", new Date("2026-05-23T12:00:00Z"));
    expect(readPredictions("1")!.lockedAt).toBe("2026-05-23T12:00:00.000Z");
  });

  it("is idempotent: a second call doesn't overwrite the first", () => {
    writePredictions("1", [entry(1)]);
    markLocked("1", new Date("2026-05-23T12:00:00Z"));
    markLocked("1", new Date("2027-01-01T00:00:00Z"));
    expect(readPredictions("1")!.lockedAt).toBe("2026-05-23T12:00:00.000Z");
  });

  it("is a no-op when no predictions exist for the event", () => {
    markLocked("999");
    expect(readPredictions("999")).toBeNull();
  });

  it("writePredictions preserves lockedAt across a schema-malformed payload (raw-parse fallback)", () => {
    // Write a malformed payload that still carries a valid lockedAt
    // string. Without the raw-parse fallback in writePredictions,
    // readPredictions would return null and the next write would
    // clobber lockedAt with null. CR #281 flagged this.
    window.localStorage.setItem(
      "predict-1",
      JSON.stringify({
        // Missing `eventId` — fails isStoredShape validation.
        songs: [],
        savedAt: new Date().toISOString(),
        lockedAt: "2026-05-23T12:00:00.000Z",
      }),
    );
    expect(readPredictions("1")).toBeNull(); // confirms shape rejection
    // Write a fresh prediction; lockedAt should survive.
    writePredictions("1", [entry(1)]);
    expect(readPredictions("1")!.lockedAt).toBe("2026-05-23T12:00:00.000Z");
  });
});

describe("clearPredictions", () => {
  it("removes the key entirely", () => {
    writePredictions("1", [entry(1)]);
    clearPredictions("1");
    expect(window.localStorage.getItem("predict-1")).toBeNull();
    expect(readPredictions("1")).toBeNull();
    expect(hasPredictions("1")).toBe(false);
  });

  it("is safe to call when nothing is stored", () => {
    expect(() => clearPredictions("999")).not.toThrow();
  });
});

describe("writePredictions resilience", () => {
  it("silently swallows quota errors so callers don't see localStorage exceptions", () => {
    vi.spyOn(window.localStorage.__proto__, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError", "QuotaExceededError");
    });
    expect(() => writePredictions("1", [entry(1)])).not.toThrow();
  });
});
