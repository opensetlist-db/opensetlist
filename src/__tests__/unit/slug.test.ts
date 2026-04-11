import { describe, it, expect } from "vitest";
import { generateSlug } from "@/lib/slug";

describe("generateSlug", () => {
  it("lowercases and replaces spaces with hyphens", () => {
    expect(generateSlug("Cerise Bouquet")).toBe("cerise-bouquet");
  });

  it("keeps already lowercase text", () => {
    expect(generateSlug("dollchestra")).toBe("dollchestra");
  });

  it("removes special characters", () => {
    expect(generateSlug("ミラクラパーク!")).toBe("");
  });

  it("handles mixed ASCII and non-ASCII", () => {
    expect(generateSlug("6th Live BGP")).toBe("6th-live-bgp");
  });

  it("collapses consecutive hyphens", () => {
    expect(generateSlug("Dream  Believers")).toBe("dream-believers");
  });

  it("trims leading and trailing hyphens", () => {
    expect(generateSlug(" test ")).toBe("test");
  });

  it("replaces underscores with hyphens", () => {
    expect(generateSlug("dream_believers")).toBe("dream-believers");
  });

  it("truncates to 100 characters", () => {
    const long = "a".repeat(150);
    expect(generateSlug(long).length).toBe(100);
  });
});
