import { describe, it, expect } from "vitest";
import { sortPickerSongs } from "@/lib/predict/sortSongs";

const s = (id: number, releaseDate: string | null) => ({ id, releaseDate });

describe("sortPickerSongs", () => {
  const input = [s(1, "2023-04-26"), s(2, null), s(3, "2024-01-01"), s(4, "2023-04-26"), s(5, null)];

  it("name keeps the catalog order (a copy, not the same array)", () => {
    const out = sortPickerSongs(input, "name");
    expect(out.map((x) => x.id)).toEqual([1, 2, 3, 4, 5]);
    expect(out).not.toBe(input);
  });

  it("release: newest first, unknown dates last, ties in catalog order", () => {
    expect(sortPickerSongs(input, "release").map((x) => x.id)).toEqual([3, 1, 4, 2, 5]);
  });

  it("never mutates its input", () => {
    sortPickerSongs(input, "release");
    expect(input.map((x) => x.id)).toEqual([1, 2, 3, 4, 5]);
  });
});
