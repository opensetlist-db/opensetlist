import { describe, it, expect } from "vitest";
import { ANON_ID_MAX_LEN, parseRequiredAnonId } from "@/lib/anonId";

describe("parseRequiredAnonId", () => {
  it("accepts a present id within the cap", () => {
    const uuid = "3f2b8c1e-9a4d-4e6f-b7a1-0c2d3e4f5a6b";
    expect(parseRequiredAnonId(uuid)).toEqual({ ok: true, value: uuid });
    expect(parseRequiredAnonId("anon-abc_123")).toEqual({
      ok: true,
      value: "anon-abc_123",
    });
    const maxStr = "a".repeat(ANON_ID_MAX_LEN);
    expect(parseRequiredAnonId(maxStr)).toEqual({ ok: true, value: maxStr });
  });

  it("rejects absent ids (undefined, null, empty) — unlike parseAnonId", () => {
    for (const v of [undefined, null, ""]) {
      const result = parseRequiredAnonId(v);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toBe("invalid anonId");
    }
  });

  it("rejects over-long ids", () => {
    expect(parseRequiredAnonId("a".repeat(ANON_ID_MAX_LEN + 1)).ok).toBe(false);
  });

  it("rejects malformed ids", () => {
    for (const v of [" ", " anon", "anon ", "an on", "anon\n", "익명", "a/b", "a.b"]) {
      expect(parseRequiredAnonId(v).ok).toBe(false);
    }
  });

  it("rejects non-string types", () => {
    for (const v of [12345, {}, [], true]) {
      expect(parseRequiredAnonId(v).ok).toBe(false);
    }
  });
});
