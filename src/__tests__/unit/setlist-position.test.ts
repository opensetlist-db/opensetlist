import { describe, expect, test } from "vitest";
import { nextSetlistPosition } from "@/lib/setlist-position";

describe("nextSetlistPosition", () => {
  test("empty list → 1", () => {
    expect(nextSetlistPosition([])).toBe(1);
  });

  test("dense 1..5 → 6", () => {
    const items = [1, 2, 3, 4, 5].map((position) => ({ position }));
    expect(nextSetlistPosition(items)).toBe(6);
  });

  // The bug F6 fixes: count+1 would say 4 here (visible.length=3 → 4),
  // colliding with the existing position 4. max+1 says 5.
  test("with gap from soft-delete (visible 1, 2, 4) → 5, not 4", () => {
    const items = [1, 2, 4].map((position) => ({ position }));
    expect(nextSetlistPosition(items)).toBe(5);
  });

  test("non-sequential after multiple deletes (1, 7) → 8", () => {
    const items = [1, 7].map((position) => ({ position }));
    expect(nextSetlistPosition(items)).toBe(8);
  });

  test("unordered input is fine (5, 1, 3) → 6", () => {
    const items = [5, 1, 3].map((position) => ({ position }));
    expect(nextSetlistPosition(items)).toBe(6);
  });
});
