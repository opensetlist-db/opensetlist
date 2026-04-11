import { describe, it, expect } from "vitest";
import { displayName } from "@/lib/display";

describe("displayName", () => {
  it("returns shortName when available", () => {
    expect(
      displayName({
        name: "蓮ノ空女学院スクールアイドルクラブ",
        shortName: "蓮ノ空",
      })
    ).toBe("蓮ノ空");
  });

  it("falls back to name when shortName is null", () => {
    expect(
      displayName({
        name: "蓮ノ空女学院スクールアイドルクラブ",
        shortName: null,
      })
    ).toBe("蓮ノ空女学院スクールアイドルクラブ");
  });

  it("falls back to name when shortName is undefined", () => {
    expect(
      displayName({
        name: "蓮ノ空女学院スクールアイドルクラブ",
      })
    ).toBe("蓮ノ空女学院スクールアイドルクラブ");
  });

  it("returns full name in full mode even when shortName exists", () => {
    expect(
      displayName(
        {
          name: "蓮ノ空女学院スクールアイドルクラブ",
          shortName: "蓮ノ空",
        },
        "full"
      )
    ).toBe("蓮ノ空女学院スクールアイドルクラブ");
  });
});
