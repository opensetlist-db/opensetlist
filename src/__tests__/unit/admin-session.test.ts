// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { adminSessionToken, isValidAdminSession, safeEqual } from "@/lib/admin-session";

const ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ENV };
});

describe("admin session token", () => {
  it("is null when no secret is configured (fail closed)", async () => {
    delete process.env.ADMIN_SESSION_SECRET;
    delete process.env.ADMIN_PASSWORD;
    expect(await adminSessionToken()).toBeNull();
    expect(await isValidAdminSession("anything")).toBe(false);
  });

  it("is derived from the secret, deterministic, and never the old hard-coded value", async () => {
    delete process.env.ADMIN_SESSION_SECRET;
    process.env.ADMIN_PASSWORD = "pw-one";
    const a = await adminSessionToken();
    const b = await adminSessionToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
    expect(a).not.toBe("opensetlist_admin_v1");
    process.env.ADMIN_PASSWORD = "pw-two";
    expect(await adminSessionToken()).not.toBe(a);
  });

  it("prefers ADMIN_SESSION_SECRET over ADMIN_PASSWORD", async () => {
    process.env.ADMIN_PASSWORD = "pw";
    delete process.env.ADMIN_SESSION_SECRET;
    const fromPassword = await adminSessionToken();
    process.env.ADMIN_SESSION_SECRET = "secret";
    expect(await adminSessionToken()).not.toBe(fromPassword);
  });

  it("accepts only the current token", async () => {
    process.env.ADMIN_PASSWORD = "pw";
    const token = (await adminSessionToken())!;
    expect(await isValidAdminSession(token)).toBe(true);
    expect(await isValidAdminSession("opensetlist_admin_v1")).toBe(false);
    expect(await isValidAdminSession(undefined)).toBe(false);
    expect(await isValidAdminSession("")).toBe(false);
    expect(await isValidAdminSession(token.slice(0, -1) + (token.endsWith("0") ? "1" : "0"))).toBe(false);
  });

  it("safeEqual compares exactly", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});
