import { describe, it, expect, beforeEach } from "vitest";
import { hasPredictions, predictKey } from "@/lib/predictionsStorage";

beforeEach(() => {
  window.localStorage.clear();
});

describe("predictKey", () => {
  it("namespaces by eventId", () => {
    expect(predictKey("42")).toBe("predict-42");
    expect(predictKey("123")).toBe("predict-123");
  });
});

describe("hasPredictions", () => {
  it("returns false when no value is stored", () => {
    expect(hasPredictions("1")).toBe(false);
  });

  it("returns true when valid JSON is stored", () => {
    window.localStorage.setItem("predict-1", JSON.stringify({ slots: [] }));
    expect(hasPredictions("1")).toBe(true);
  });

  it("returns true even for an empty array payload (any valid JSON counts)", () => {
    // Tab visibility is intentionally permissive — Stage C tightens
    // the shape contract. An empty-but-present payload still means
    // "the user opened the prediction surface" and the tab should
    // show.
    window.localStorage.setItem("predict-1", JSON.stringify([]));
    expect(hasPredictions("1")).toBe(true);
  });

  it("returns false on malformed JSON (no crash)", () => {
    window.localStorage.setItem("predict-1", "not-json{");
    expect(hasPredictions("1")).toBe(false);
  });

  it("scopes by eventId — predictions for one event don't leak to another", () => {
    window.localStorage.setItem("predict-1", JSON.stringify({ x: 1 }));
    expect(hasPredictions("1")).toBe(true);
    expect(hasPredictions("2")).toBe(false);
  });
});
