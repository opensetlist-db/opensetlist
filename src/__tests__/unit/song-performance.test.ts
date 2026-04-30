import { describe, it, expect } from "vitest";
import { getSongPerformanceCells } from "@/lib/songPerformance";

describe("getSongPerformanceCells", () => {
  it("passes through encore + position unchanged", () => {
    const cells = getSongPerformanceCells({
      isEncore: true,
      position: 5,
    });
    expect(cells).toEqual({
      isEncore: true,
      position: 5,
    });
  });

  it("preserves false isEncore", () => {
    const cells = getSongPerformanceCells({
      isEncore: false,
      position: 1,
    });
    expect(cells.isEncore).toBe(false);
  });

  it("doesn't shift position (schema is 1-based)", () => {
    // Sanity check: position 1 stays 1, position 21 stays 21.
    // A future bug that adds `+1` would break the encore-set
    // displayed numbers; this assertion catches that immediately.
    expect(getSongPerformanceCells({ isEncore: false, position: 1 }).position).toBe(1);
    expect(getSongPerformanceCells({ isEncore: false, position: 21 }).position).toBe(21);
  });

  it("passes through position 0 defensively (shouldn't happen, but doesn't crash)", () => {
    // The schema is 1-based, so position 0 indicates a data bug
    // upstream. The helper doesn't sanitize — that's the data
    // layer's responsibility — but it doesn't crash either.
    const cells = getSongPerformanceCells({
      isEncore: false,
      position: 0,
    });
    expect(cells.position).toBe(0);
  });
});
