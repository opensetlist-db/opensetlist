import { describe, expect, it } from "vitest";
import {
  buildLogoSeriesGraph,
  decideSeriesLogo,
  explainSeriesLogo,
  type LogoSeriesNode,
} from "@/lib/logoResolution";
import {
  assignmentFromConflict,
  attemptCommittedFromConflict,
  classifyModeChangeReply,
  conflictMine,
  reconcileModeChange,
  reconcileUpload,
  resolutionText,
  type LogoCardState,
} from "@/lib/adminLogoCard";
import type { AdminAttemptEvidence, AdminLogoAssignment, AdminLogoPreview } from "@/lib/adminLogo";

// Admin series logo card: the source explanation added next to the public
// resolver, and the card's pure outcome rules (lost replies, conflicts,
// retries). The handler → DB → cache path is integration/series-logo-route.

const asset = { publicUrl: "https://img.example/logo.webp", width: 400, height: 200 };

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

describe("explainSeriesLogo", () => {
  const chain = (root: Partial<LogoSeriesNode>, leaf: Partial<LogoSeriesNode> = {}) =>
    buildLogoSeriesGraph([series(1, root), series(2, { parentSeriesId: BigInt(1), ...leaf })]);

  it("names the ancestor whose custom logo is inherited", () => {
    const g = chain({ logoMode: "custom", logoAsset: asset });
    expect(explainSeriesLogo(BigInt(2), g)).toEqual({
      decision: decideSeriesLogo(BigInt(2), g),
      sourceSeriesId: BigInt(1),
    });
  });

  it("names the series itself for its own custom logo / typography stop", () => {
    expect(explainSeriesLogo(BigInt(2), chain({}, { logoMode: "custom", logoAsset: asset })).sourceSeriesId).toBe(
      BigInt(2),
    );
    expect(explainSeriesLogo(BigInt(2), chain({ logoMode: "typography" })).sourceSeriesId).toBe(BigInt(1));
  });

  it("has no source when every node inherits or the chain breaks", () => {
    expect(explainSeriesLogo(BigInt(2), chain({}))).toEqual({
      decision: { kind: "typography", reason: "exhausted" },
      sourceSeriesId: null,
    });
    const cyclic = buildLogoSeriesGraph([
      series(1, { parentSeriesId: BigInt(2) }),
      series(2, { parentSeriesId: BigInt(1) }),
    ]);
    expect(explainSeriesLogo(BigInt(2), cyclic)).toEqual({
      decision: { kind: "typography", reason: "broken-chain" },
      sourceSeriesId: null,
    });
  });

  it("agrees with decideSeriesLogo on every case (same walk)", () => {
    const graphs = [
      chain({}),
      chain({ logoMode: "custom", logoAsset: asset }),
      chain({ logoMode: "custom", logoAsset: null }),
      chain({ logoMode: "typography" }, { logoMode: "custom", logoAsset: asset }),
      chain({ isDeleted: true }),
    ];
    for (const g of graphs) {
      expect(explainSeriesLogo(BigInt(2), g).decision).toEqual(decideSeriesLogo(BigInt(2), g));
    }
  });
});

const INHERIT: AdminLogoAssignment = { mode: "inherit", assetId: null };
const MINE: AdminLogoAssignment = { mode: "custom", assetId: "a1" };
const OTHER: AdminLogoAssignment = { mode: "custom", assetId: "b2" };
const preview: AdminLogoPreview = { imageUrl: null, reason: "exhausted", source: null };

function state(assignment: AdminLogoAssignment, attempt: AdminAttemptEvidence | null = null): LogoCardState {
  return {
    assignment,
    asset: null,
    applied: preview,
    previews: { inherit: preview, typography: { ...preview, reason: "typography-mode" } },
    attempt,
  };
}

describe("reconcileUpload (lost upload reply)", () => {
  it("committed and held → reflected", () => {
    expect(reconcileUpload(state(MINE, { state: "committed", assetId: "a1", held: true }), INHERIT)).toBe(
      "reflected",
    );
  });

  it("committed but no longer held → superseded, even when the slot is back to the expected value", () => {
    // inherit → my upload → someone unlinked to inherit again: mine WAS saved.
    expect(reconcileUpload(state(INHERIT, { state: "committed", assetId: "a1", held: false }), INHERIT)).toBe(
      "superseded",
    );
  });

  it("no row and the expected value unchanged → unchanged (not proof the request ended)", () => {
    expect(reconcileUpload(state(INHERIT, { state: "not-observed" }), INHERIT)).toBe("unchanged");
  });

  it("no row and another value → superseded", () => {
    expect(reconcileUpload(state(OTHER, { state: "not-observed" }), INHERIT)).toBe("superseded");
  });

  it("ambiguous / unavailable evidence stays undetermined", () => {
    expect(reconcileUpload(state(INHERIT, { state: "ambiguous" }), INHERIT)).toBe("undetermined");
    expect(reconcileUpload(state(INHERIT, { state: "unavailable" }), INHERIT)).toBe("undetermined");
    expect(reconcileUpload(state(INHERIT, null), INHERIT)).toBe("undetermined");
  });
});

describe("reconcileModeChange (lost PATCH reply)", () => {
  const TYPO: AdminLogoAssignment = { mode: "typography", assetId: null };
  it("current == next → reflected; == expected → unchanged; else superseded", () => {
    expect(reconcileModeChange(state(TYPO), MINE, TYPO)).toBe("reflected");
    expect(reconcileModeChange(state(MINE), MINE, TYPO)).toBe("unchanged");
    expect(reconcileModeChange(state(OTHER), MINE, TYPO)).toBe("superseded");
  });
});

describe("classifyModeChangeReply", () => {
  it("2xx → saved, 409 → conflict", () => {
    expect(classifyModeChangeReply(200, { status: "saved" }, false)).toEqual({ kind: "saved" });
    expect(classifyModeChangeReply(409, { outcome: "conflict" }, false).kind).toBe("conflict");
  });

  it("server-declared unknown and bare 5xx → unknown", () => {
    expect(classifyModeChangeReply(503, { outcome: "unknown", message: "m" }, false)).toEqual({
      kind: "unknown",
      message: "m",
    });
    expect(classifyModeChangeReply(504, null, false).kind).toBe("unknown");
  });

  it("known pre-commit failure and plain 4xx → not_saved on a first send", () => {
    expect(classifyModeChangeReply(500, { outcome: "not_saved" }, false).kind).toBe("not_saved");
    expect(classifyModeChangeReply(400, { outcome: "not_saved" }, false).kind).toBe("not_saved");
    expect(classifyModeChangeReply(401, { error: "Unauthorized" }, false).kind).toBe("not_saved");
  });

  it("after an unknown send, a later failure stays unknown", () => {
    expect(classifyModeChangeReply(400, { outcome: "not_saved" }, true).kind).toBe("unknown");
    expect(classifyModeChangeReply(401, null, true).kind).toBe("unknown");
    // A conflict is still a conflict.
    expect(classifyModeChangeReply(409, { outcome: "conflict" }, true).kind).toBe("conflict");
  });
});

describe("conflict body", () => {
  it("normalises the shared 409 `current` shape", () => {
    expect(assignmentFromConflict({ current: { logoMode: "custom", logoAssetId: "x" } })).toEqual({
      mode: "custom",
      assetId: "x",
    });
    expect(assignmentFromConflict({ current: { logoMode: "inherit", logoAssetId: null } })).toEqual(INHERIT);
    expect(assignmentFromConflict({ current: { imageUrl: "u" } })).toBeNull();
    expect(assignmentFromConflict(null)).toBeNull();
    expect(attemptCommittedFromConflict({ attemptCommitted: true })).toBe(true);
    expect(attemptCommittedFromConflict({})).toBe(false);
  });
});

describe("conflictMine (was MY change saved?)", () => {
  it("upload: decided by the attempt's committed evidence", () => {
    expect(conflictMine("upload", { attemptCommitted: true, afterLostReply: true })).toBe("saved");
    expect(conflictMine("upload", { attemptCommitted: false, afterLostReply: true })).toBe("not_saved");
    expect(conflictMine("upload", { attemptCommitted: false, afterLostReply: false })).toBe("not_saved");
  });

  it("mode change: not saved only on a first send; after a lost reply it is unknown", () => {
    expect(conflictMine("mode", { attemptCommitted: false, afterLostReply: false })).toBe("not_saved");
    // expected → next may have committed and been overwritten since.
    expect(conflictMine("mode", { attemptCommitted: false, afterLostReply: true })).toBe("unknown");
  });
});

describe("resolutionText", () => {
  it("names an ancestor source and never the series itself", () => {
    const src = { imageUrl: "u", reason: "custom" as const, source: { id: "1", name: "親", isSelf: false } };
    expect(resolutionText("inherit", src, false)).toContain("「親」");
    expect(resolutionText("inherit", { ...preview, reason: "broken-chain" }, false)).toContain("끊겨");
    expect(resolutionText("custom", src, true)).toContain("불러올 수 없어");
  });
});
