import { describe, expect, it } from "vitest";
import {
  buildLogoSeriesGraph,
  decideEventLogo,
  decideSeriesLogo,
  eventColorSource,
  resolveEventLogo,
  resolveSeriesLogo,
  type LogoEventInput,
  type LogoSeriesNode,
} from "@/lib/logoResolution";

// Pure inheritance rules: event → own series → ancestors, custom wins,
// typography stops, exhaustion = typography, safe termination. The DB
// boundary (real rows, private columns, cache tagging) is covered by
// integration/logo-resolution.test.ts and unit/logo-series-graph-cache.

const asset = (n: number) => ({
  publicUrl: `https://img.example/logo-${n}.webp`,
  width: 400 + n,
  height: 200,
});
const image = (n: number) => ({ url: asset(n).publicUrl, width: 400 + n, height: 200 });

function series(id: number, over: Partial<LogoSeriesNode> = {}): LogoSeriesNode {
  return {
    id: BigInt(id),
    parentSeriesId: null,
    isDeleted: false,
    logoMode: "inherit",
    logoAsset: null,
    artistId: null,
    artist: null,
    ...over,
  };
}
function event(over: Partial<LogoEventInput> = {}): LogoEventInput {
  return { eventSeriesId: null, logoMode: "inherit", logoAsset: null, artist: null, ...over };
}

// root(1) ← mid(2) ← leaf(3); events hang off leaf unless noted.
function chain(
  root: Partial<LogoSeriesNode> = {},
  mid: Partial<LogoSeriesNode> = {},
  leaf: Partial<LogoSeriesNode> = {},
) {
  return buildLogoSeriesGraph([
    series(1, root),
    series(2, { parentSeriesId: BigInt(1), ...mid }),
    series(3, { parentSeriesId: BigInt(2), ...leaf }),
  ]);
}
const leafEvent = (over: Partial<LogoEventInput> = {}) => event({ eventSeriesId: BigInt(3), ...over });

describe("logo inheritance", () => {
  it("defaults (all inherit, no assets) to typography by exhaustion", () => {
    expect(decideEventLogo(leafEvent(), chain())).toEqual({
      kind: "typography",
      reason: "exhausted",
    });
  });

  it("an event without a series is exhausted immediately", () => {
    expect(decideEventLogo(event(), chain({ logoMode: "custom", logoAsset: asset(1) }))).toEqual({
      kind: "typography",
      reason: "exhausted",
    });
  });

  it("inherits the nearest custom ancestor", () => {
    const g = chain({ logoMode: "custom", logoAsset: asset(1) }, { logoMode: "custom", logoAsset: asset(2) });
    expect(decideEventLogo(leafEvent(), g)).toEqual({ kind: "custom", from: "series", image: image(2) });
  });

  it("inherits a grandparent logo through inheriting nodes", () => {
    const g = chain({ logoMode: "custom", logoAsset: asset(1) });
    expect(resolveEventLogo(leafEvent(), g).image).toEqual(image(1));
  });

  it("an event custom override beats every series logo", () => {
    const g = chain({ logoMode: "custom", logoAsset: asset(1) });
    expect(decideEventLogo(leafEvent({ logoMode: "custom", logoAsset: asset(9) }), g)).toEqual({
      kind: "custom",
      from: "event",
      image: image(9),
    });
  });

  it("event typography stops inheritance of an ancestor logo", () => {
    const g = chain({ logoMode: "custom", logoAsset: asset(1) });
    expect(decideEventLogo(leafEvent({ logoMode: "typography" }), g)).toEqual({
      kind: "typography",
      reason: "typography-mode",
    });
  });

  it("series typography stops inheritance below an ancestor logo", () => {
    const g = chain({ logoMode: "custom", logoAsset: asset(1) }, { logoMode: "typography" });
    expect(decideEventLogo(leafEvent(), g)).toEqual({ kind: "typography", reason: "typography-mode" });
  });

  it("a descendant custom wins before an ancestor typography stop", () => {
    const g = chain({ logoMode: "typography" }, {}, { logoMode: "custom", logoAsset: asset(3) });
    expect(resolveEventLogo(leafEvent(), g).image).toEqual(image(3));
  });

  it("unlinking a direct logo (custom → inherit) restores the inherited one", () => {
    const before = chain({ logoMode: "custom", logoAsset: asset(1) }, {}, { logoMode: "custom", logoAsset: asset(3) });
    const after = chain({ logoMode: "custom", logoAsset: asset(1) }, {}, { logoMode: "inherit", logoAsset: null });
    expect(resolveEventLogo(leafEvent(), before).image).toEqual(image(3));
    expect(resolveEventLogo(leafEvent(), after).image).toEqual(image(1));
    // Same for an event-level unlink.
    expect(resolveEventLogo(leafEvent({ logoMode: "inherit", logoAsset: null }), after).image).toEqual(image(1));
  });

  it("a series page starts at its own node, ignoring descendants", () => {
    const g = chain({ logoMode: "custom", logoAsset: asset(1) }, {}, { logoMode: "custom", logoAsset: asset(3) });
    expect(resolveSeriesLogo(BigInt(2), g).image).toEqual(image(1));
    expect(resolveSeriesLogo(BigInt(3), g).image).toEqual(image(3));
    expect(decideSeriesLogo(BigInt(2), chain({}, { logoMode: "typography" }))).toEqual({
      kind: "typography",
      reason: "typography-mode",
    });
  });
});

describe("safe termination and failed assets", () => {
  it("terminates a parent cycle with typography", () => {
    const g = buildLogoSeriesGraph([
      series(1, { parentSeriesId: BigInt(2) }),
      series(2, { parentSeriesId: BigInt(1) }),
    ]);
    expect(decideEventLogo(event({ eventSeriesId: BigInt(1) }), g)).toEqual({
      kind: "typography",
      reason: "broken-chain",
    });
    expect(decideSeriesLogo(BigInt(2), g)).toEqual({ kind: "typography", reason: "broken-chain" });
  });

  it("terminates a self-parented series", () => {
    const g = buildLogoSeriesGraph([series(1, { parentSeriesId: BigInt(1) })]);
    expect(decideSeriesLogo(BigInt(1), g).kind).toBe("typography");
  });

  it("stops at a missing parent rather than skipping it", () => {
    const g = buildLogoSeriesGraph([series(3, { parentSeriesId: BigInt(99) })]);
    expect(decideEventLogo(leafEvent(), g)).toEqual({ kind: "typography", reason: "broken-chain" });
    expect(decideEventLogo(event({ eventSeriesId: BigInt(42) }), g)).toEqual({
      kind: "typography",
      reason: "broken-chain",
    });
  });

  it("does not inherit through a soft-deleted series", () => {
    const g = chain({ logoMode: "custom", logoAsset: asset(1) }, { isDeleted: true });
    expect(decideEventLogo(leafEvent(), g)).toEqual({ kind: "typography", reason: "broken-chain" });
  });

  it("ends a pathologically deep chain", () => {
    const rows = Array.from({ length: 40 }, (_, i) =>
      series(i + 1, { parentSeriesId: i === 39 ? null : BigInt(i + 2) }),
    );
    rows[39] = series(40, { logoMode: "custom", logoAsset: asset(40) });
    expect(decideSeriesLogo(BigInt(1), buildLogoSeriesGraph(rows))).toEqual({
      kind: "typography",
      reason: "broken-chain",
    });
  });

  it("an unusable selected asset is typography, never an ancestor retry", () => {
    const g = chain({ logoMode: "custom", logoAsset: asset(1) });
    const bad = [
      null,
      { ...asset(9), publicUrl: "" },
      { ...asset(9), publicUrl: "javascript:alert(1)" },
      { ...asset(9), width: 0 },
      { ...asset(9), height: -1 },
    ];
    for (const logoAsset of bad) {
      expect(decideEventLogo(leafEvent({ logoMode: "custom", logoAsset }), g)).toEqual({
        kind: "typography",
        reason: "unusable-asset",
      });
      const sg = chain({ logoMode: "custom", logoAsset: asset(1) }, {}, { logoMode: "custom", logoAsset });
      expect(decideEventLogo(leafEvent(), sg)).toEqual({ kind: "typography", reason: "unusable-asset" });
    }
  });

  it("an asset on a non-custom node is ignored", () => {
    // The DB CHECK forbids it; the resolver still never reads it.
    const g = chain({}, {}, { logoMode: "inherit", logoAsset: asset(3) });
    expect(resolveEventLogo(leafEvent({ logoAsset: asset(9) }), g).image).toBeNull();
  });
});

describe("typography colour source", () => {
  const red = { color: "#E50080", isDeleted: false };
  const blue = { color: "#165DCC", isDeleted: false };

  it("prefers the series representative artist", () => {
    const g = chain({}, {}, { artistId: BigInt(7), artist: red });
    expect(eventColorSource(leafEvent({ artist: blue }), g)).toEqual({
      kind: "series-artist",
      color: "#E50080",
    });
  });

  it("takes the representative from the nearest series up the chain", () => {
    const g = chain({ artistId: BigInt(7), artist: red });
    expect(resolveEventLogo(leafEvent({ artist: blue }), g).color).toBe("#E50080");
    expect(resolveSeriesLogo(BigInt(3), g).color).toBe("#E50080");
  });

  it("a nearer representative without colour does not reach an ancestor's artist", () => {
    const g = chain({ artistId: BigInt(7), artist: red }, { artistId: BigInt(8), artist: { color: null, isDeleted: false } });
    expect(eventColorSource(leafEvent({ artist: blue }), g)).toEqual({
      kind: "event-artist",
      color: "#165DCC",
    });
  });

  it("falls back to the event representative artist, then the brand", () => {
    expect(eventColorSource(leafEvent({ artist: blue }), chain())).toEqual({
      kind: "event-artist",
      color: "#165DCC",
    });
    expect(eventColorSource(leafEvent(), chain())).toEqual({ kind: "brand" });
    expect(resolveEventLogo(leafEvent(), chain()).color).toBeNull();
    expect(resolveSeriesLogo(BigInt(1), chain()).color).toBeNull();
  });

  it("ignores deleted artists and malformed colours", () => {
    const g = chain({}, {}, { artistId: BigInt(7), artist: { color: "#E50080", isDeleted: true } });
    expect(eventColorSource(leafEvent({ artist: { color: "red", isDeleted: false } }), g)).toEqual({
      kind: "brand",
    });
  });

  it("a cyclic chain yields no series colour but keeps the event artist", () => {
    const g = buildLogoSeriesGraph([series(1, { parentSeriesId: BigInt(2) }), series(2, { parentSeriesId: BigInt(1) })]);
    expect(eventColorSource(event({ eventSeriesId: BigInt(1), artist: blue }), g)).toEqual({
      kind: "event-artist",
      color: "#165DCC",
    });
  });
});

describe("public projection", () => {
  it("carries only delivery fields and colour", () => {
    const g = chain({ logoMode: "custom", logoAsset: asset(1), artistId: BigInt(7), artist: { color: "#E50080", isDeleted: false } });
    const out = resolveEventLogo(leafEvent(), g);
    expect(out).toEqual({ image: image(1), color: "#E50080" });
    expect(Object.keys(out).sort()).toEqual(["color", "image"]);
    expect(Object.keys(out.image!).sort()).toEqual(["height", "url", "width"]);
  });

  it("does not leak extra asset columns even if a caller over-selects", () => {
    const leaky = {
      ...asset(1),
      id: "asset-uuid",
      objectKey: "redesign/logo-1.webp",
      sourceUrl: "https://source.example/private",
      usageNote: "internal note",
    };
    const g = chain({ logoMode: "custom", logoAsset: leaky });
    const json = JSON.stringify(resolveEventLogo(leafEvent(), g));
    for (const secret of ["asset-uuid", "redesign/logo-1.webp", "source.example", "internal note"]) {
      expect(json).not.toContain(secret);
    }
  });
});
