import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock prisma — all findUnique return null (no collisions) by default
const mockFindUnique = vi.fn().mockResolvedValue(null);
vi.mock("@/lib/prisma", () => ({
  prisma: {
    artist: { findUnique: (...args: unknown[]) => mockFindUnique(...args) },
    song: { findUnique: (...args: unknown[]) => mockFindUnique(...args) },
    event: { findUnique: (...args: unknown[]) => mockFindUnique(...args) },
    eventSeries: { findUnique: (...args: unknown[]) => mockFindUnique(...args) },
    album: { findUnique: (...args: unknown[]) => mockFindUnique(...args) },
  },
}));

// Mock kuroshiro — return romaji for known test inputs
vi.mock("kuroshiro", () => {
  return {
    default: class MockKuroshiro {
      async init() {}
      async convert(input: string) {
        const map: Record<string, string> = {
          "ハナムスビ": "hana musubi",
          "ドルケストラ": "dorukesutora",
          "上昇気流にのせて": "joushou kiryuu ni nosete",
        };
        return map[input] ?? "";
      }
    },
  };
});

vi.mock("kuroshiro-analyzer-kuromoji", () => {
  return { default: class MockAnalyzer {} };
});

import { generateUniqueSlug } from "@/lib/slug";

beforeEach(() => {
  mockFindUnique.mockReset().mockResolvedValue(null);
});

describe("generateUniqueSlug", () => {
  it("generates slug from ASCII input", async () => {
    const slug = await generateUniqueSlug("Dream Believers", "song");
    expect(slug).toBe("dream-believers");
  });

  it("transliterates Japanese to romaji", async () => {
    const slug = await generateUniqueSlug("ハナムスビ", "song");
    expect(slug).toBe("hana-musubi");
  });

  it("transliterates longer Japanese text", async () => {
    const slug = await generateUniqueSlug("ドルケストラ", "artist");
    expect(slug).toBe("dorukesutora");
  });

  it("appends -1 when slug already exists", async () => {
    // First call: "dream-believers" exists
    // Second call: "dream-believers-1" does not exist
    mockFindUnique
      .mockResolvedValueOnce({ id: 1 }) // exists
      .mockResolvedValue(null); // not exists

    const slug = await generateUniqueSlug("Dream Believers", "song");
    expect(slug).toBe("dream-believers-1");
  });

  it("increments suffix until unique", async () => {
    mockFindUnique
      .mockResolvedValueOnce({ id: 1 }) // "dream-believers" exists
      .mockResolvedValueOnce({ id: 2 }) // "dream-believers-1" exists
      .mockResolvedValueOnce({ id: 3 }) // "dream-believers-2" exists
      .mockResolvedValue(null); // "dream-believers-3" free

    const slug = await generateUniqueSlug("Dream Believers", "song");
    expect(slug).toBe("dream-believers-3");
  });

  it("falls back to model-timestamp when transliteration also empty", async () => {
    // Input that produces empty slug even after transliteration
    const slug = await generateUniqueSlug("한글만", "artist");
    // Korean-only → generateSlug returns "" → transliterate returns "" → fallback
    expect(slug).toMatch(/^artist-\d+$/);
  });

  it("works with different model types", async () => {
    expect(await generateUniqueSlug("Test Event", "event")).toBe("test-event");
    expect(await generateUniqueSlug("Test Series", "eventSeries")).toBe("test-series");
    expect(await generateUniqueSlug("Test Album", "album")).toBe("test-album");
  });
});
