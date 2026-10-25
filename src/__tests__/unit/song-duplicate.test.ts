import { describe, it, expect } from "vitest";
import {
  findDuplicateSongs,
  type ExistingSongForDuplicateCheck,
} from "@/lib/songDuplicate";

// The prod case that motivated the check: the hand-entered row and the
// catalog-import row for 「ペレニアル」 under two slugs.
const pereniaru: ExistingSongForDuplicateCheck = {
  id: BigInt(769),
  slug: "pereniaru",
  originalTitle: "ペレニアル",
  variantLabel: null,
  artistSlugs: ["kaho-solo", "sayaka-solo", "rurino-solo"],
};

const otherGroupSameTitle: ExistingSongForDuplicateCheck = {
  id: BigInt(10),
  slug: "hana-other",
  originalTitle: "花",
  variantLabel: null,
  artistSlugs: ["some-other-group"],
};

describe("findDuplicateSongs", () => {
  it("flags a new slug with the same title, variant and artist set", () => {
    const dups = findDuplicateSongs(
      {
        slug: "perennial",
        originalTitle: "ペレニアル",
        variantLabel: "",
        // different order than the existing row
        artistSlugs: ["rurino-solo", "kaho-solo", "sayaka-solo"],
      },
      [pereniaru],
      new Set(),
    );
    expect(dups.map((d) => d.slug)).toEqual(["pereniaru"]);
  });

  it("does not flag a row whose own slug already exists (an update)", () => {
    const dups = findDuplicateSongs(
      {
        slug: "perennial",
        originalTitle: "ペレニアル",
        variantLabel: null,
        artistSlugs: ["kaho-solo", "sayaka-solo", "rurino-solo"],
      },
      [pereniaru],
      new Set(["perennial"]),
    );
    expect(dups).toEqual([]);
  });

  it("does not flag a same-titled song by different artists", () => {
    const dups = findDuplicateSongs(
      {
        slug: "hana-new",
        originalTitle: "花",
        variantLabel: null,
        artistSlugs: ["kaho-solo"],
      },
      [otherGroupSameTitle],
      new Set(),
    );
    expect(dups).toEqual([]);
  });

  it("does not flag a different variant of the same song", () => {
    const dups = findDuplicateSongs(
      {
        slug: "perennial-acoustic",
        originalTitle: "ペレニアル",
        variantLabel: "Acoustic Ver.",
        artistSlugs: ["kaho-solo", "sayaka-solo", "rurino-solo"],
      },
      [pereniaru],
      new Set(),
    );
    expect(dups).toEqual([]);
  });

  it("compares titles after NFKC and case folding", () => {
    const dups = findDuplicateSongs(
      {
        slug: "dream-believers-2",
        originalTitle: " ＤＲＥＡＭ Believers ",
        variantLabel: null,
        artistSlugs: [],
      },
      [
        {
          id: BigInt(1),
          slug: "dream-believers",
          originalTitle: "Dream Believers",
          variantLabel: null,
          artistSlugs: ["hasunosora"],
        },
      ],
      new Set(),
    );
    // no artist_slugs in the CSV row → title + variant alone decide
    expect(dups.map((d) => d.slug)).toEqual(["dream-believers"]);
  });
});
