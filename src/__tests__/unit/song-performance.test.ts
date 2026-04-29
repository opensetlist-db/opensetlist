import { describe, it, expect } from "vitest";
import { getSongPerformanceCells } from "@/lib/songPerformance";

describe("getSongPerformanceCells", () => {
  it("passes through encore + position + note unchanged", () => {
    const cells = getSongPerformanceCells({
      isEncore: true,
      position: 5,
      note: "acoustic ver.",
    });
    expect(cells).toEqual({
      isEncore: true,
      position: 5,
      note: "acoustic ver.",
    });
  });

  it("preserves false isEncore", () => {
    const cells = getSongPerformanceCells({
      isEncore: false,
      position: 1,
      note: null,
    });
    expect(cells.isEncore).toBe(false);
  });

  it("preserves null note (no fallback to empty string)", () => {
    // The page renders the note chip only when truthy; preserving
    // null vs "" lets the consumer use a simple `&& note &&` guard
    // without a separate length check.
    const cells = getSongPerformanceCells({
      isEncore: false,
      position: 1,
      note: null,
    });
    expect(cells.note).toBeNull();
  });

  it("doesn't shift position (schema is 1-based)", () => {
    // Sanity check: position 1 stays 1, position 21 stays 21.
    // A future bug that adds `+1` would break the encore-set
    // displayed numbers; this assertion catches that immediately.
    expect(getSongPerformanceCells({ isEncore: false, position: 1, note: null }).position).toBe(1);
    expect(getSongPerformanceCells({ isEncore: false, position: 21, note: null }).position).toBe(21);
  });

  it("passes through position 0 defensively (shouldn't happen, but doesn't crash)", () => {
    // The schema is 1-based, so position 0 indicates a data bug
    // upstream. The helper doesn't sanitize — that's the data
    // layer's responsibility — but it doesn't crash either.
    const cells = getSongPerformanceCells({
      isEncore: false,
      position: 0,
      note: null,
    });
    expect(cells.position).toBe(0);
  });
});
