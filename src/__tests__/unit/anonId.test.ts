import { describe, it, expect } from "vitest";
import { ANON_ID_MAX_LEN, parseAnonId } from "@/lib/anonId";

describe("parseAnonId", () => {
  it("undefined → ok with value=null (legacy / no-anon client)", () => {
    expect(parseAnonId(undefined)).toEqual({ ok: true, value: null });
  });

  it("empty string → ok with value=null (localStorage-disabled client)", () => {
    expect(parseAnonId("")).toEqual({ ok: true, value: null });
  });

  it("non-empty string within length cap → ok with that string", () => {
    expect(parseAnonId("anon-abc-123")).toEqual({
      ok: true,
      value: "anon-abc-123",
    });
  });

  it("string exactly at length cap → ok", () => {
    const maxStr = "a".repeat(ANON_ID_MAX_LEN);
    expect(parseAnonId(maxStr)).toEqual({ ok: true, value: maxStr });
  });

  it("string longer than length cap → not ok", () => {
    const result = parseAnonId("a".repeat(ANON_ID_MAX_LEN + 1));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe("invalid anonId");
  });

  it("non-string types → not ok", () => {
    expect(parseAnonId(12345).ok).toBe(false);
    expect(parseAnonId(null).ok).toBe(false);
    expect(parseAnonId({}).ok).toBe(false);
    expect(parseAnonId([]).ok).toBe(false);
    expect(parseAnonId(true).ok).toBe(false);
  });
});
