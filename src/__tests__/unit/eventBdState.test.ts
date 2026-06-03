import { describe, it, expect } from "vitest";
import {
  resolveEventBdState,
  selectTopBonuses,
  type AlbumBdInput,
  type AlbumStoreListingBdInput,
  type AlbumStoreBonusBdInput,
  type EventBdInput,
} from "@/lib/eventBdState";

const NOW = new Date("2026-05-15T03:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

// Pre-built event templates. Each test mutates only the field under
// scrutiny so the noise-to-signal ratio in the assertions stays low.
function eventAt(
  startTime: string | Date,
  overrides: Partial<EventBdInput> = {},
): EventBdInput {
  return {
    startTime,
    status: "scheduled",
    bdAlbumId: null,
    ...overrides,
  };
}

function album(overrides: Partial<AlbumBdInput> = {}): AlbumBdInput {
  return {
    releaseDate: null,
    listings: [],
    ...overrides,
  };
}

function listing(
  overrides: Partial<AlbumStoreListingBdInput> & {
    originalStoreName?: string;
  } = {},
): AlbumStoreListingBdInput & { originalStoreName: string } {
  return {
    status: "active",
    startsAt: null,
    endsAt: null,
    bonuses: [],
    originalStoreName: "Amazon JP",
    ...overrides,
  };
}

function bonus(
  overrides: Partial<AlbumStoreBonusBdInput> = {},
): AlbumStoreBonusBdInput {
  return {
    startsAt: null,
    endsAt: null,
    bonusImageUrl: null,
    ...overrides,
  };
}

describe("resolveEventBdState — time-bucket scale (no BD link)", () => {
  it("returns 'pre' when event is upcoming", () => {
    const event = eventAt(new Date(NOW.getTime() + 7 * DAY_MS));
    expect(resolveEventBdState(event, null, NOW)).toBe("pre");
  });

  it("returns 'pre' when event.status === 'ongoing'", () => {
    const event = eventAt(new Date(NOW.getTime() - 30 * 60 * 1000), {
      status: "ongoing",
    });
    expect(resolveEventBdState(event, null, NOW)).toBe("pre");
  });

  it("returns 'pre' when event.status === 'cancelled' regardless of BD link", () => {
    const event = eventAt(new Date(NOW.getTime() - 30 * DAY_MS), {
      status: "cancelled",
      bdAlbumId: "42",
    });
    expect(
      resolveEventBdState(event, album({ releaseDate: NOW }), NOW),
    ).toBe("pre");
  });

  it("returns 'immediate_post' at D+0", () => {
    const event = eventAt(NOW, { status: "completed" });
    expect(resolveEventBdState(event, null, NOW)).toBe("immediate_post");
  });

  it("returns 'immediate_post' inside the D+60 window", () => {
    const event = eventAt(new Date(NOW.getTime() - 30 * DAY_MS), {
      status: "completed",
    });
    expect(resolveEventBdState(event, null, NOW)).toBe("immediate_post");
  });

  it("crosses to 'long_mid' exactly at D+60", () => {
    const event = eventAt(new Date(NOW.getTime() - 60 * DAY_MS), {
      status: "completed",
    });
    expect(resolveEventBdState(event, null, NOW)).toBe("long_mid");
  });

  it("stays 'long_mid' deep past D+60 when no BD linked", () => {
    const event = eventAt(new Date(NOW.getTime() - 365 * DAY_MS), {
      status: "completed",
    });
    expect(resolveEventBdState(event, null, NOW)).toBe("long_mid");
  });

  it("returns 'immediate_post' when startTime is missing (defensive)", () => {
    const event = eventAt(null as unknown as string, { status: "completed" });
    expect(resolveEventBdState(event, null, NOW)).toBe("immediate_post");
  });
});

describe("resolveEventBdState — post-link buckets (album resolves)", () => {
  it("returns 'bd_announced' when album linked, no listings, no release date", () => {
    const event = eventAt(new Date(NOW.getTime() - 90 * DAY_MS), {
      status: "completed",
      bdAlbumId: "42",
    });
    expect(resolveEventBdState(event, album(), NOW)).toBe("bd_announced");
  });

  it("returns 'bd_preorder' when ≥1 active bonus and release is in the future", () => {
    const event = eventAt(new Date(NOW.getTime() - 90 * DAY_MS), {
      status: "completed",
      bdAlbumId: "42",
    });
    const futureRelease = new Date(NOW.getTime() + 30 * DAY_MS);
    const bd = album({
      releaseDate: futureRelease,
      listings: [listing({ bonuses: [bonus()] })],
    });
    expect(resolveEventBdState(event, bd, NOW)).toBe("bd_preorder");
  });

  it("returns 'bd_preorder' when active bonus exists but release date is null", () => {
    const event = eventAt(new Date(NOW.getTime() - 90 * DAY_MS), {
      status: "completed",
      bdAlbumId: "42",
    });
    const bd = album({ listings: [listing({ bonuses: [bonus()] })] });
    expect(resolveEventBdState(event, bd, NOW)).toBe("bd_preorder");
  });

  it("returns 'bd_released' when releaseDate ≤ now AND active bonus remains", () => {
    const event = eventAt(new Date(NOW.getTime() - 180 * DAY_MS), {
      status: "completed",
      bdAlbumId: "42",
    });
    const bd = album({
      releaseDate: new Date(NOW.getTime() - DAY_MS),
      listings: [listing({ bonuses: [bonus()] })],
    });
    expect(resolveEventBdState(event, bd, NOW)).toBe("bd_released");
  });

  it("returns 'bd_released' when releaseDate ≤ now AND all bonuses ended (compact)", () => {
    const event = eventAt(new Date(NOW.getTime() - 180 * DAY_MS), {
      status: "completed",
      bdAlbumId: "42",
    });
    const bd = album({
      releaseDate: new Date(NOW.getTime() - 30 * DAY_MS),
      listings: [listing({ status: "ended", bonuses: [bonus()] })],
    });
    expect(resolveEventBdState(event, bd, NOW)).toBe("bd_released");
  });

  it("returns 'pre' when bdAlbumId set but event is still upcoming", () => {
    const event = eventAt(new Date(NOW.getTime() + 7 * DAY_MS), {
      bdAlbumId: "42",
    });
    const bd = album({ listings: [listing({ bonuses: [bonus()] })] });
    expect(resolveEventBdState(event, bd, NOW)).toBe("pre");
  });

  it("falls back to time-bucket when bdAlbumId is set but album is null (deleted/not fetched)", () => {
    const event = eventAt(new Date(NOW.getTime() - 90 * DAY_MS), {
      status: "completed",
      bdAlbumId: "42",
    });
    expect(resolveEventBdState(event, null, NOW)).toBe("long_mid");
  });

  it("ignores bonuses whose effective window has closed", () => {
    const event = eventAt(new Date(NOW.getTime() - 90 * DAY_MS), {
      status: "completed",
      bdAlbumId: "42",
    });
    const bd = album({
      releaseDate: new Date(NOW.getTime() + 10 * DAY_MS),
      listings: [
        listing({
          bonuses: [bonus({ endsAt: new Date(NOW.getTime() - DAY_MS) })],
        }),
      ],
    });
    expect(resolveEventBdState(event, bd, NOW)).toBe("bd_announced");
  });

  it("respects bonus-level endsAt overriding listing endsAt", () => {
    const event = eventAt(new Date(NOW.getTime() - 90 * DAY_MS), {
      status: "completed",
      bdAlbumId: "42",
    });
    const bd = album({
      releaseDate: new Date(NOW.getTime() + 10 * DAY_MS),
      listings: [
        listing({
          // Listing window is open
          endsAt: new Date(NOW.getTime() + 7 * DAY_MS),
          // But this bonus closed earlier
          bonuses: [bonus({ endsAt: new Date(NOW.getTime() - DAY_MS) })],
        }),
      ],
    });
    expect(resolveEventBdState(event, bd, NOW)).toBe("bd_announced");
  });

  it("ignores bonuses whose effective window hasn't opened yet", () => {
    const event = eventAt(new Date(NOW.getTime() - 90 * DAY_MS), {
      status: "completed",
      bdAlbumId: "42",
    });
    const bd = album({
      releaseDate: new Date(NOW.getTime() + 30 * DAY_MS),
      listings: [
        listing({
          bonuses: [bonus({ startsAt: new Date(NOW.getTime() + DAY_MS) })],
        }),
      ],
    });
    expect(resolveEventBdState(event, bd, NOW)).toBe("bd_announced");
  });

  it("counts a sold_out listing's bonuses as active (still visible)", () => {
    const event = eventAt(new Date(NOW.getTime() - 90 * DAY_MS), {
      status: "completed",
      bdAlbumId: "42",
    });
    const bd = album({
      releaseDate: new Date(NOW.getTime() + 10 * DAY_MS),
      listings: [listing({ status: "sold_out", bonuses: [bonus()] })],
    });
    expect(resolveEventBdState(event, bd, NOW)).toBe("bd_preorder");
  });
});

describe("selectTopBonuses", () => {
  it("caps at the supplied limit (default 3)", () => {
    const listings = [
      listing({
        bonuses: [bonus(), bonus(), bonus(), bonus(), bonus()],
      }),
    ];
    expect(selectTopBonuses(listings, NOW)).toHaveLength(3);
    expect(selectTopBonuses(listings, NOW, 2)).toHaveLength(2);
  });

  it("excludes ended listings entirely", () => {
    const listings = [
      listing({ status: "ended", bonuses: [bonus(), bonus()] }),
    ];
    expect(selectTopBonuses(listings, NOW)).toHaveLength(0);
  });

  it("excludes bonuses past their effective endsAt", () => {
    const listings = [
      listing({
        bonuses: [
          bonus({ endsAt: new Date(NOW.getTime() - DAY_MS) }),
          bonus({ endsAt: new Date(NOW.getTime() + DAY_MS) }),
        ],
      }),
    ];
    expect(selectTopBonuses(listings, NOW)).toHaveLength(1);
  });

  it("orders by store priority — Amazon before アニメイト", () => {
    const animateBonus = bonus();
    const amazonBonus = bonus();
    const listings = [
      listing({ originalStoreName: "アニメイト", bonuses: [animateBonus] }),
      listing({ originalStoreName: "Amazon JP", bonuses: [amazonBonus] }),
    ];
    const top = selectTopBonuses(listings, NOW);
    expect(top[0].bonus).toBe(amazonBonus);
    expect(top[1].bonus).toBe(animateBonus);
  });

  it("orders unknown stores at the end of the priority list", () => {
    const wellKnownBonus = bonus();
    const noNameBonus = bonus();
    const listings = [
      listing({
        originalStoreName: "Some random store",
        bonuses: [noNameBonus],
      }),
      listing({ originalStoreName: "Amazon JP", bonuses: [wellKnownBonus] }),
    ];
    const top = selectTopBonuses(listings, NOW);
    expect(top[0].bonus).toBe(wellKnownBonus);
    expect(top[1].bonus).toBe(noNameBonus);
  });

  it("within the same store rank, active leads sold_out", () => {
    const soldOutBonus = bonus();
    const activeBonus = bonus();
    const listings = [
      listing({
        originalStoreName: "Amazon JP",
        status: "sold_out",
        bonuses: [soldOutBonus],
      }),
      listing({
        originalStoreName: "Amazon JP",
        status: "active",
        bonuses: [activeBonus],
      }),
    ];
    const top = selectTopBonuses(listings, NOW);
    expect(top[0].bonus).toBe(activeBonus);
    expect(top[1].bonus).toBe(soldOutBonus);
  });

  it("within the same rank and status, image-bearing bonus leads imageless", () => {
    const noImage = bonus();
    const hasImage = bonus({ bonusImageUrl: "https://example.com/cover.jpg" });
    const listings = [
      listing({
        originalStoreName: "Amazon JP",
        bonuses: [noImage, hasImage],
      }),
    ];
    const top = selectTopBonuses(listings, NOW);
    expect(top[0].bonus).toBe(hasImage);
    expect(top[1].bonus).toBe(noImage);
  });

  it("pairs each bonus with its parent listing in the output", () => {
    const targetListing = listing({
      originalStoreName: "Amazon JP",
      bonuses: [bonus()],
    });
    const top = selectTopBonuses([targetListing], NOW);
    expect(top[0].listing).toBe(targetListing);
  });
});
