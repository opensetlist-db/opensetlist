import { describe, it, expect } from "vitest";
import {
  reconcile,
  type ExistingListingRow,
  type ParsedCandidates,
} from "@/lib/album-bonus-import";

// Reconciler is the b10 import path's core decision layer — every
// "insert / update-changed / update-noop" badge the operator sees on
// the review surface comes from this function. The tests below cover
// the four flows the apply endpoint actually executes, plus the
// "unreferenced existing listing" awareness signal that surfaces
// rows the news page doesn't mention.

const baseCandidates: ParsedCandidates = {
  sourceUrl: null,
  parsedAt: "2026-05-28T00:00:00Z",
  albumTitleGuess: null,
  releaseDateGuess: null,
  listings: [
    {
      originalStoreName: "アニメイト",
      originalEditionLabel: null,
      productUrl: "https://animate-onlineshop.jp/products/foo",
      bonuses: [
        {
          originalBonusType: "B2タペストリー",
          originalBonusDescription: null,
          bonusImageUrl: null,
        },
      ],
    },
    {
      originalStoreName: "Amazon.co.jp",
      originalEditionLabel: null,
      productUrl: null,
      bonuses: [
        {
          originalBonusType: "スリーブケース",
          originalBonusDescription: null,
          bonusImageUrl: null,
        },
      ],
    },
  ],
  globalEarlyBooking: null,
  warnings: [],
};

describe("reconcile()", () => {
  it("classifies every listing as insert when DB has nothing for this album", () => {
    const result = reconcile(baseCandidates, []);
    expect(result.listings).toHaveLength(2);
    expect(result.listings[0].kind).toBe("insert");
    expect(result.listings[0].matchedListingId).toBeNull();
    expect(result.listings[1].kind).toBe("insert");
    expect(result.unreferencedListings).toHaveLength(0);
  });

  it("emits update-noop when an exact match exists with identical productUrl", () => {
    const existing: ExistingListingRow[] = [
      {
        id: "L-anime",
        originalStoreName: "アニメイト",
        originalEditionLabel: null,
        productUrl: "https://animate-onlineshop.jp/products/foo",
        bonuses: [],
      },
    ];
    const result = reconcile(baseCandidates, existing);
    expect(result.listings[0].kind).toBe("update-noop");
    expect(result.listings[0].matchedListingId).toBe("L-anime");
    expect(result.listings[0].diffs).toEqual([]);
  });

  it("emits update-changed when productUrl differs and surfaces the diff", () => {
    const existing: ExistingListingRow[] = [
      {
        id: "L-anime",
        originalStoreName: "アニメイト",
        originalEditionLabel: null,
        productUrl: "https://animate-onlineshop.jp/old-url",
        bonuses: [],
      },
    ];
    const result = reconcile(baseCandidates, existing);
    expect(result.listings[0].kind).toBe("update-changed");
    expect(result.listings[0].matchedListingId).toBe("L-anime");
    expect(result.listings[0].diffs).toEqual([
      {
        field: "productUrl",
        from: "https://animate-onlineshop.jp/old-url",
        to: "https://animate-onlineshop.jp/products/foo",
      },
    ]);
  });

  it("does NOT propose an update when candidate productUrl is null but existing has one", () => {
    // Empty input shouldn't clobber operator-curated data. The parser
    // emits null when it can't extract a URL; reconcile must not
    // interpret that as "set URL to null."
    const candidatesWithNullUrl: ParsedCandidates = {
      ...baseCandidates,
      listings: [
        {
          ...baseCandidates.listings[0],
          productUrl: null,
        },
        baseCandidates.listings[1],
      ],
    };
    const existing: ExistingListingRow[] = [
      {
        id: "L-anime",
        originalStoreName: "アニメイト",
        originalEditionLabel: null,
        productUrl: "https://animate-onlineshop.jp/existing",
        bonuses: [],
      },
    ];
    const result = reconcile(candidatesWithNullUrl, existing);
    expect(result.listings[0].kind).toBe("update-noop");
    expect(result.listings[0].diffs).toEqual([]);
  });

  it("matches bonuses exact on (listingId, originalBonusType) — noop on match, insert otherwise", () => {
    const existing: ExistingListingRow[] = [
      {
        id: "L-anime",
        originalStoreName: "アニメイト",
        originalEditionLabel: null,
        productUrl: "https://animate-onlineshop.jp/products/foo",
        bonuses: [
          { id: "B-1", originalBonusType: "B2タペストリー" },
        ],
      },
    ];
    const result = reconcile(baseCandidates, existing);
    // Listing 0 (アニメイト) matches existing → bonus 0 matches existing → noop
    expect(result.bonuses[0]).toEqual({
      listingIdx: 0,
      bonusIdx: 0,
      kind: "update-noop",
      matchedBonusId: "B-1",
    });
    // Listing 1 (Amazon) has no match → its bonus is insert
    expect(result.bonuses[1]).toEqual({
      listingIdx: 1,
      bonusIdx: 0,
      kind: "insert",
      matchedBonusId: null,
    });
  });

  it("treats variant-marker bonuses as separate inserts (per pattern-notes §5)", () => {
    // The schema-design contract: 'B2タペストリー (Mira)' and
    // 'B2タペストリー (Cerise)' on the same listing are intentional
    // duplicates and must not collapse together.
    const candidates: ParsedCandidates = {
      ...baseCandidates,
      listings: [
        {
          originalStoreName: "Amazon.co.jp",
          originalEditionLabel: null,
          productUrl: null,
          bonuses: [
            { originalBonusType: "B2タペストリー (Mira)", originalBonusDescription: null, bonusImageUrl: null },
            { originalBonusType: "B2タペストリー (Cerise)", originalBonusDescription: null, bonusImageUrl: null },
            { originalBonusType: "B2タペストリー (DOLLCHESTRA)", originalBonusDescription: null, bonusImageUrl: null },
          ],
        },
      ],
    };
    const existing: ExistingListingRow[] = [
      {
        id: "L-amazon",
        originalStoreName: "Amazon.co.jp",
        originalEditionLabel: null,
        productUrl: null,
        bonuses: [
          { id: "B-mira", originalBonusType: "B2タペストリー (Mira)" },
          // Cerise + DOLLCHESTRA missing → should be inserts
        ],
      },
    ];
    const result = reconcile(candidates, existing);
    expect(result.bonuses).toHaveLength(3);
    expect(result.bonuses[0].kind).toBe("update-noop");
    expect(result.bonuses[0].matchedBonusId).toBe("B-mira");
    expect(result.bonuses[1].kind).toBe("insert");
    expect(result.bonuses[2].kind).toBe("insert");
  });

  it("surfaces unreferenced existing listings without proposing changes to them", () => {
    // The news page mentions アニメイト + Amazon, but HMV is already
    // on the album. HMV must surface as awareness only — reconcile
    // does NOT classify it as an end / delete candidate, because the
    // news page can't speak to retailer-side state.
    const existing: ExistingListingRow[] = [
      {
        id: "L-anime",
        originalStoreName: "アニメイト",
        originalEditionLabel: null,
        productUrl: "https://animate-onlineshop.jp/products/foo",
        bonuses: [],
      },
      {
        id: "L-hmv",
        originalStoreName: "HMV",
        originalEditionLabel: null,
        productUrl: null,
        bonuses: [],
      },
    ];
    const result = reconcile(baseCandidates, existing);
    expect(result.unreferencedListings).toEqual([
      { listingId: "L-hmv", originalStoreName: "HMV" },
    ]);
  });

  it("treats different originalEditionLabel as a distinct listing (no match)", () => {
    // Operator added an existing listing under 初回限定盤A; the news
    // page describes the single-edition release (label null). These
    // must NOT collide — different editions are different listings.
    const existing: ExistingListingRow[] = [
      {
        id: "L-anime-A",
        originalStoreName: "アニメイト",
        originalEditionLabel: "初回限定盤A",
        productUrl: null,
        bonuses: [],
      },
    ];
    const result = reconcile(baseCandidates, existing);
    expect(result.listings[0].kind).toBe("insert");
    expect(result.unreferencedListings).toEqual([
      { listingId: "L-anime-A", originalStoreName: "アニメイト" },
    ]);
  });
});
