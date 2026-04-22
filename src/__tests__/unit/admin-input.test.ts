import { describe, it, expect } from "vitest";
import {
  enumValue,
  nullableBigIntId,
  nullableBoolean,
  nullableEnumValue,
  nullableStringArray,
  originalLanguage,
} from "@/lib/admin-input";

const ARTIST_TYPES = ["solo", "group", "unit"] as const;

describe("enumValue", () => {
  it("accepts an allowed value", () => {
    const r = enumValue("solo", "type", ARTIST_TYPES);
    expect(r).toEqual({ ok: true, value: "solo" });
  });

  it("rejects unknown enum string", () => {
    const r = enumValue("invalid", "type", ARTIST_TYPES);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("type must be one of");
  });

  it("rejects undefined / null / empty string as missing", () => {
    for (const v of [undefined, null, ""]) {
      const r = enumValue(v, "type", ARTIST_TYPES);
      expect(r).toEqual({ ok: false, message: "type is required" });
    }
  });

  it("rejects non-string", () => {
    const r = enumValue(123, "type", ARTIST_TYPES);
    expect(r).toEqual({ ok: false, message: "type is required" });
  });
});

describe("nullableEnumValue", () => {
  it("returns null for undefined / null / empty", () => {
    for (const v of [undefined, null, ""]) {
      expect(nullableEnumValue(v, "type", ARTIST_TYPES)).toEqual({
        ok: true,
        value: null,
      });
    }
  });

  it("rejects unknown enum string", () => {
    const r = nullableEnumValue("invalid", "type", ARTIST_TYPES);
    expect(r.ok).toBe(false);
  });

  it("rejects non-string with type message", () => {
    const r = nullableEnumValue(42, "type", ARTIST_TYPES);
    expect(r).toEqual({ ok: false, message: "type must be a string" });
  });
});

describe("nullableBigIntId", () => {
  it("returns null for undefined / null / empty", () => {
    for (const v of [undefined, null, ""]) {
      expect(nullableBigIntId(v, "id")).toEqual({ ok: true, value: null });
    }
  });

  it("accepts non-negative integer number", () => {
    expect(nullableBigIntId(42, "id")).toEqual({ ok: true, value: BigInt(42) });
    expect(nullableBigIntId(0, "id")).toEqual({ ok: true, value: BigInt(0) });
  });

  it("accepts digit-only string", () => {
    expect(nullableBigIntId("9876543210", "id")).toEqual({
      ok: true,
      value: BigInt("9876543210"),
    });
  });

  it("rejects non-digit strings — bare BigInt() would throw SyntaxError on these", () => {
    for (const v of ["abc", "1.5", "-1", " 1 ", "1e10"]) {
      const r = nullableBigIntId(v, "id");
      expect(r.ok).toBe(false);
    }
  });

  it("rejects objects, arrays, booleans", () => {
    for (const v of [{}, [], true, 1.5, -1]) {
      const r = nullableBigIntId(v, "id");
      expect(r.ok).toBe(false);
    }
  });

  it("rejects unsafe-integer numbers — JSON.parse loses precision above 2^53-1", () => {
    const r = nullableBigIntId(Number.MAX_SAFE_INTEGER + 1, "id");
    expect(r.ok).toBe(false);
  });
});

describe("nullableBoolean", () => {
  it("returns null for undefined / null / empty", () => {
    for (const v of [undefined, null, ""]) {
      expect(nullableBoolean(v, "hasBoard")).toEqual({ ok: true, value: null });
    }
  });

  it("accepts true and false", () => {
    expect(nullableBoolean(true, "hasBoard")).toEqual({ ok: true, value: true });
    expect(nullableBoolean(false, "hasBoard")).toEqual({ ok: true, value: false });
  });

  it("rejects truthy / falsy non-booleans — strings, numbers, objects", () => {
    for (const v of ["true", "false", 1, 0, {}, []]) {
      const r = nullableBoolean(v, "hasBoard");
      expect(r.ok).toBe(false);
    }
  });
});

describe("nullableStringArray", () => {
  it("returns [] for undefined / null", () => {
    expect(nullableStringArray(undefined, "ids")).toEqual({ ok: true, value: [] });
    expect(nullableStringArray(null, "ids")).toEqual({ ok: true, value: [] });
  });

  it("accepts an array of strings", () => {
    expect(nullableStringArray(["a", "b"], "ids")).toEqual({
      ok: true,
      value: ["a", "b"],
    });
    expect(nullableStringArray([], "ids")).toEqual({ ok: true, value: [] });
  });

  it("rejects non-array", () => {
    const r = nullableStringArray("a,b", "ids");
    expect(r.ok).toBe(false);
  });

  it("rejects array containing a non-string", () => {
    const r = nullableStringArray(["a", 1, "c"], "ids");
    expect(r.ok).toBe(false);
  });

  it("trims each element and rejects empty/whitespace-only entries", () => {
    expect(nullableStringArray([" a ", "b"], "ids")).toEqual({
      ok: true,
      value: ["a", "b"],
    });
    for (const v of [["a", ""], ["a", "   "]]) {
      const r = nullableStringArray(v, "ids");
      expect(r.ok).toBe(false);
    }
  });
});

describe("originalLanguage", () => {
  it("rejects missing", () => {
    for (const v of [undefined, null, ""]) {
      const r = originalLanguage(v);
      expect(r).toEqual({ ok: false, message: "originalLanguage is required" });
    }
  });

  it("normalizes jp → ja", () => {
    expect(originalLanguage("jp")).toEqual({ ok: true, value: "ja" });
  });

  it("rejects unknown locale", () => {
    const r = originalLanguage("xx");
    expect(r.ok).toBe(false);
  });

  it("rejects non-string", () => {
    expect(originalLanguage(123)).toEqual({
      ok: false,
      message: "originalLanguage must be a string",
    });
  });
});
