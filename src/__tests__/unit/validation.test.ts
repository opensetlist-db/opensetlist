import { describe, it, expect } from "vitest";
import { validateEncoreOrder } from "@/lib/validation";

describe("validateEncoreOrder", () => {
  it("returns null when all encores come after non-encores", () => {
    const items = [
      { position: 1, isEncore: false },
      { position: 2, isEncore: false },
      { position: 3, isEncore: true },
    ];
    expect(validateEncoreOrder(items)).toBeNull();
  });

  it("returns error when encore is before non-encore", () => {
    const items = [
      { position: 1, isEncore: false },
      { position: 2, isEncore: true },
      { position: 3, isEncore: false },
    ];
    expect(validateEncoreOrder(items)).toContain("position 2");
    expect(validateEncoreOrder(items)).toContain("position 3");
  });

  it("returns error when encore has same position as non-encore", () => {
    const items = [
      { position: 1, isEncore: false },
      { position: 2, isEncore: true },
      { position: 2, isEncore: false },
    ];
    expect(validateEncoreOrder(items)).not.toBeNull();
  });

  it("returns null when no encore items exist", () => {
    const items = [
      { position: 1, isEncore: false },
      { position: 2, isEncore: false },
    ];
    expect(validateEncoreOrder(items)).toBeNull();
  });

  it("returns null when only encore items exist", () => {
    const items = [
      { position: 1, isEncore: true },
      { position: 2, isEncore: true },
    ];
    expect(validateEncoreOrder(items)).toBeNull();
  });

  it("returns null for empty array", () => {
    expect(validateEncoreOrder([])).toBeNull();
  });

  it("returns null for single non-encore item", () => {
    expect(validateEncoreOrder([{ position: 1, isEncore: false }])).toBeNull();
  });

  it("returns null for single encore item", () => {
    expect(validateEncoreOrder([{ position: 1, isEncore: true }])).toBeNull();
  });

  it("handles non-sequential positions correctly", () => {
    const items = [
      { position: 1, isEncore: false },
      { position: 5, isEncore: false },
      { position: 10, isEncore: true },
      { position: 11, isEncore: true },
    ];
    expect(validateEncoreOrder(items)).toBeNull();
  });

  it("detects error with non-sequential positions", () => {
    const items = [
      { position: 1, isEncore: false },
      { position: 10, isEncore: true },
      { position: 15, isEncore: false },
    ];
    expect(validateEncoreOrder(items)).not.toBeNull();
  });
});
