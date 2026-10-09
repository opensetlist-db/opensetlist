import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  buildArtistHierarchy,
  descendantsOf,
  rootOf,
} from "@/lib/artistHierarchy";

// 1 Hasunosora ─┬─ 2 Cerise Bouquet ── 5 (synthetic depth-2 node)
//               └─ 3 DOLLCHESTRA
// 10 Liella! (no children)
const H = buildArtistHierarchy([
  { id: BigInt(1), parentArtistId: null },
  { id: BigInt(2), parentArtistId: BigInt(1) },
  { id: BigInt(3), parentArtistId: BigInt(1) },
  { id: BigInt(5), parentArtistId: BigInt(2) },
  { id: BigInt(10), parentArtistId: null },
]);

describe("artistHierarchy", () => {
  it("resolves a unit-only link to its root group", () => {
    expect(rootOf(H, BigInt(2))).toBe("1");
    // number vs bigint input must not matter (`1n === 1` is false)
    expect(rootOf(H, 2)).toBe("1");
    expect(rootOf(H, 5)).toBe("1");
  });

  it("returns the id itself for a root or an unknown id", () => {
    expect(rootOf(H, BigInt(10))).toBe("10");
    expect(rootOf(H, 404)).toBe("404");
  });

  it("stops at the last known node when the parent is missing (deleted)", () => {
    const h = buildArtistHierarchy([{ id: BigInt(7), parentArtistId: BigInt(6) }]);
    expect(rootOf(h, 7)).toBe("7");
  });

  it("terminates on a malformed cycle", () => {
    const h = buildArtistHierarchy([
      { id: BigInt(1), parentArtistId: BigInt(2) },
      { id: BigInt(2), parentArtistId: BigInt(1) },
    ]);
    expect(["1", "2"]).toContain(rootOf(h, 1));
  });

  it("descendants: depth 1", () => {
    expect(descendantsOf(H, 2)).toEqual(["2", "5"]);
    expect(descendantsOf(H, 10)).toEqual(["10"]);
  });

  it("descendants: root first, includes depth 2", () => {
    expect(descendantsOf(H, BigInt(1))).toEqual(["1", "2", "3", "5"]);
  });
});
