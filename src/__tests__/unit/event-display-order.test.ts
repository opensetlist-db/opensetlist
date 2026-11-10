import { describe, expect, it } from "vitest";
import { createEventDisplayOrdering } from "@/lib/eventDisplayOrder";
import type { ArtistOrderKey } from "@/lib/officialOrder";

const group = { id: "1", parentArtistId: null, type: "group", sortOrder: 1 } as const;
const units = [
  { id: "9007199254740992", parentArtistId: "1", type: "unit", sortOrder: 2 },
  { id: "9007199254740993", parentArtistId: "1", type: "unit", sortOrder: 1 },
] satisfies ArtistOrderKey[];
const ordering = createEventDisplayOrdering({ artists: [group, ...units], guestIds: ["guest"] });
const performer = (id: string, sortOrder: number, unitRanks: (number | null)[] = []) => ({
  stageIdentity: {
    id, sortOrder, createdAt: "2026-01-01T00:00:00.000Z",
    artistLinks: [{ artistId: group.id, sortOrder: null }, ...unitRanks.map((rank, i) => ({
      artistId: Number(units[i].id), orderArtistId: units[i].id, sortOrder: rank,
    }))],
  },
  realPersonId: `actor-${id}`,
});
const kaho = performer("kaho", 1, [2, 1]);
const ginko = performer("ginko", 7, [1, 2]);
const guest = performer("guest", 0, [0]);
const noUnit = performer("sayaka", 2);
const credit = (artist: ArtistOrderKey) => ({
  artist: { ...artist, orderId: String(artist.id), id: Number(artist.id) },
});
const item = {
  stageType: "unit", position: 7, isEncore: true,
  songs: [{ id: 2, order: 2 }, { id: 3, order: 3 }],
  artists: [credit(units[0])],
  performers: [kaho, guest, ginko],
};
const performerIds = (rows: ReadonlyArray<{ stageIdentity: { id: string } }>) => rows.map(({ stageIdentity }) => stageIdentity.id);

describe("event display ordering", () => {
  it("uses the unit relation without changing the actual credits or song order", () => {
    const result = ordering.sortItem(item);
    expect(performerIds(result.performers)).toEqual(["ginko", "kaho", "guest"]);
    expect(result.performers).toEqual([ginko, kaho, guest]);
    expect(result.songs).toBe(item.songs);
    expect(result.position).toBe(7);
    expect(result.isEncore).toBe(true);
    expect(performerIds(item.performers)).toEqual(["kaho", "guest", "ginko"]);
  });

  it("prefers the first eligible unit in official order and keeps group-only performers", () => {
    const result = ordering.sortItem({
      ...item, stageType: "special", artists: [credit(units[0]), credit(units[1])],
      performers: [ginko, noUnit, guest, kaho],
    });
    expect(result.artists.map(({ artist }) => artist.orderId)).toEqual([units[1].id, units[0].id]);
    expect(performerIds(result.performers)).toEqual(["kaho", "ginko", "sayaka", "guest"]);
  });

  it("uses the group credited on the item for dual-affiliated members", () => {
    const second = { id: "3", parentArtistId: null, type: "group", sortOrder: 2 } as const;
    const dual = {
      ...kaho, stageIdentity: {
        ...kaho.stageIdentity, artistLinks: [...kaho.stageIdentity.artistLinks, { artistId: second.id, sortOrder: 2 }],
      },
    };
    const home = {
      ...noUnit, stageIdentity: {
        ...noUnit.stageIdentity, artistLinks: [{ artistId: second.id, sortOrder: 1 }],
      },
    };
    const result = createEventDisplayOrdering({ artists: [group, second, ...units], guestIds: [] })
      .sortItem({ ...item, stageType: "full_group", artists: [credit(second)], performers: [dual, home] });
    expect(performerIds(result.performers)).toEqual(["sayaka", "kaho"]);
  });

  it.each(["full_group", "solo", "special"])("uses group/default order when %s has no eligible unit", (stageType) => {
    const result = ordering.sortItem({
      ...item, stageType, artists: stageType === "full_group" ? item.artists : [],
      performers: [ginko, guest, noUnit, kaho],
    });
    expect(performerIds(result.performers)).toEqual(["kaho", "sayaka", "ginko", "guest"]);
  });
});
