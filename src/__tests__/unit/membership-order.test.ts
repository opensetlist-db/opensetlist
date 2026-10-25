import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { parseMembershipRank } from "@/lib/membershipOrderImport";
import { sortAdminMembers } from "@/lib/adminOfficialOrder";

describe("membership-order CSV contract", () => {
  it("preserves blank/missing, explicitly clears, and validates signed Int bounds", () => {
    expect(parseMembershipRank(undefined)).toBeUndefined();
    expect(parseMembershipRank(" ")).toBeUndefined();
    expect(parseMembershipRank("__CLEAR__")).toBeNull();
    for (const number of [0, -1, -2147483648, 2147483647]) expect(parseMembershipRank(String(number))).toBe(number);
    for (const text of ["null", "1.5", "NaN", "2147483648", "-2147483649", "1e2"]) expect(parseMembershipRank(text)).toBe("invalid");
  });
  it("uses the common group order for mixed admin pickers and explicit unit context independently", () => {
    const artists = [
      { id: BigInt(10), type: "group" as const, sortOrder: 1, parentArtistId: null },
      { id: BigInt(2), type: "group" as const, sortOrder: 2, parentArtistId: null },
      { id: BigInt(20), type: "unit" as const, sortOrder: null, parentArtistId: BigInt(10) },
    ];
    const a = { id: "a", sortOrder: 1, createdAt: "2020-01-01T00:00:00Z", artistLinks: [{ artistId: BigInt(10), sortOrder: null }, { artistId: BigInt(20), sortOrder: 2 }] };
    const b = { ...a, id: "b", sortOrder: 2, artistLinks: [{ artistId: BigInt(10), sortOrder: null }, { artistId: BigInt(20), sortOrder: 1 }] };
    const c = { ...a, id: "c", artistLinks: [{ artistId: BigInt(2), sortOrder: null }] };
    const input = Object.freeze([c, b, a]);
    expect(sortAdminMembers(input, (row) => row, artists).map((row) => row.id)).toEqual(["a", "b", "c"]);
    expect(sortAdminMembers([b, a], (row) => row, artists, { kind: "artist", artistId: BigInt(20) }).map((row) => row.id)).toEqual(["b", "a"]);
    expect(input.map((row) => row.id)).toEqual(["c", "b", "a"]);
    expect(a.artistLinks[1].sortOrder).toBe(2);
  });
});
