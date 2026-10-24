import { describe, expect, it } from "vitest";
import {
  buildLogoSeriesGraph,
  decideEventLogo,
  explainEventLogo,
  type LogoEventInput,
  type LogoSeriesNode,
} from "@/lib/logoResolution";
import { eventResolutionText, resolutionText } from "@/lib/adminLogoCard";
import type { AdminLogoPreview } from "@/lib/adminLogo";

// Admin event logo override card: the event explanation next to the
// public resolver (must never disagree with `decideEventLogo`), and the
// event wording under the preview. The handler → DB → cache path is
// integration/event-logo-route.

const asset = { publicUrl: "https://img.example/logo.webp", width: 400, height: 200 };
const otherAsset = { publicUrl: "https://img.example/event.webp", width: 300, height: 300 };

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
  return { eventSeriesId: BigInt(2), logoMode: "inherit", logoAsset: null, artist: null, ...over };
}

/** Parent 1 ← child 2 (the event's series). */
const graphOf = (root: Partial<LogoSeriesNode> = {}, leaf: Partial<LogoSeriesNode> = {}) =>
  buildLogoSeriesGraph([series(1, root), series(2, { parentSeriesId: BigInt(1), ...leaf })]);

describe("explainEventLogo", () => {
  it("inherits the nearest series custom logo and names that series", () => {
    const g = graphOf({ logoMode: "custom", logoAsset: asset });
    expect(explainEventLogo(event(), g)).toEqual({
      decision: { kind: "custom", image: { url: asset.publicUrl, width: 400, height: 200 } },
      source: { seriesId: BigInt(1) },
    });
  });

  it("an event custom logo wins over an ancestor typography stop", () => {
    const g = graphOf({ logoMode: "typography" });
    const own = explainEventLogo(event({ logoMode: "custom", logoAsset: otherAsset }), g);
    expect(own.source).toBe("event");
    expect(own.decision).toEqual({
      kind: "custom",
      image: { url: otherAsset.publicUrl, width: 300, height: 300 },
    });
  });

  it("an event typography stop is decided by the event itself", () => {
    const g = graphOf({ logoMode: "custom", logoAsset: asset });
    expect(explainEventLogo(event({ logoMode: "typography" }), g)).toEqual({
      decision: { kind: "typography", reason: "typography-mode" },
      source: "event",
    });
  });

  it("an unusable own asset is typography from the event — no fallback to the series logo", () => {
    const g = graphOf({ logoMode: "custom", logoAsset: asset });
    const broken = { publicUrl: "not-a-url", width: 10, height: 10 };
    expect(explainEventLogo(event({ logoMode: "custom", logoAsset: broken }), g)).toEqual({
      decision: { kind: "typography", reason: "unusable-asset" },
      source: "event",
    });
  });

  it("exhausted inheritance and a missing series have no source", () => {
    expect(explainEventLogo(event(), graphOf())).toEqual({
      decision: { kind: "typography", reason: "exhausted" },
      source: null,
    });
    expect(explainEventLogo(event({ eventSeriesId: null }), graphOf())).toEqual({
      decision: { kind: "typography", reason: "exhausted" },
      source: null,
    });
    expect(explainEventLogo(event({ eventSeriesId: BigInt(99) }), graphOf())).toEqual({
      decision: { kind: "typography", reason: "broken-chain" },
      source: null,
    });
  });

  it("always agrees with the public decideEventLogo", () => {
    const graphs = [
      graphOf(),
      graphOf({ logoMode: "custom", logoAsset: asset }),
      graphOf({ logoMode: "typography" }),
      graphOf({}, { logoMode: "custom", logoAsset: asset }),
      graphOf({ logoMode: "custom", logoAsset: asset }, { isDeleted: true }),
      buildLogoSeriesGraph([
        series(1, { parentSeriesId: BigInt(2) }),
        series(2, { parentSeriesId: BigInt(1) }),
      ]),
    ];
    const events = [
      event(),
      event({ logoMode: "typography" }),
      event({ logoMode: "custom", logoAsset: otherAsset }),
      event({ eventSeriesId: null }),
    ];
    let checked = 0;
    for (const g of graphs) {
      for (const e of events) {
        expect(explainEventLogo(e, g).decision).toEqual(decideEventLogo(e, g));
        checked++;
      }
    }
    expect(checked).toBe(graphs.length * events.length);
  });
});

describe("eventResolutionText", () => {
  const describeFor = eventResolutionText("蓮ノ空 6th Live BGP");
  const preview = (over: Partial<AdminLogoPreview>): AdminLogoPreview => ({
    imageUrl: null,
    reason: "exhausted",
    source: null,
    ...over,
  });

  it("names the event's series when nothing is inherited, as the mockup does", () => {
    expect(describeFor("inherit", preview({}), false)).toBe(
      "공연 → 蓮ノ空 6th Live BGP → 상속할 로고 없음. 공연 제목을 표시합니다.",
    );
    expect(eventResolutionText(null)("inherit", preview({}), false)).toBe(
      "연결된 시리즈가 없어 공연 제목을 표시합니다.",
    );
  });

  it("drops a missing series name instead of leaving empty brackets", () => {
    const text = describeFor("inherit", preview({ reason: "custom", imageUrl: asset.publicUrl }), false);
    expect(text).toBe("시리즈의 로고를 사용합니다. 시리즈 로고가 바뀌면 함께 바뀝니다.");
  });

  it("names the deciding series for an inherited logo or stop", () => {
    const src = { id: "1", name: "蓮ノ空", isSelf: false };
    expect(describeFor("inherit", preview({ reason: "custom", imageUrl: asset.publicUrl, source: src }), false)).toBe(
      "시리즈 「蓮ノ空」의 로고를 사용합니다. 시리즈 로고가 바뀌면 함께 바뀝니다.",
    );
    expect(describeFor("inherit", preview({ reason: "typography-mode", source: src }), false)).toBe(
      "시리즈 「蓮ノ空」에서 상속을 멈춰 공연 제목을 표시합니다.",
    );
  });

  it("never mentions descendants (nothing inherits from an event)", () => {
    // Positive control: the series wording DOES mention them for these
    // inputs, so the absence below is the event wording's own choice.
    expect(resolutionText("typography", preview({}), false)).toContain("하위");
    expect(resolutionText("inherit", preview({}), false)).toContain("하위");
    for (const mode of ["inherit", "custom", "typography"] as const) {
      for (const reason of ["custom", "exhausted", "typography-mode", "unusable-asset", "broken-chain"] as const) {
        expect(describeFor(mode, preview({ reason }), false)).not.toContain("하위");
      }
    }
  });

  it("a failed image explains typography without a poster or ancestor substitute", () => {
    expect(describeFor("custom", preview({ reason: "custom", imageUrl: asset.publicUrl }), true)).toContain(
      "포스터로 대체하지 않습니다",
    );
  });
});
