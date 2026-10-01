// @vitest-environment node
import { describe, it, expect, vi, beforeAll } from "vitest";
import { NextRequest } from "next/server";

// The i18n middleware isn't under test here — stub it so we can tell whether
// a request fell through to it.
vi.mock("next-intl/middleware", () => ({
  default: () => () => new Response("intl", { status: 299 }),
}));

import proxy from "@/proxy";
import { adminSessionToken, COOKIE_NAME } from "@/lib/admin-session";

let token: string;
beforeAll(async () => {
  process.env.ADMIN_PASSWORD = "test-password";
  delete process.env.ADMIN_SESSION_SECRET;
  token = (await adminSessionToken())!;
});

function req(path: string, cookie?: string, method = "POST") {
  const headers = new Headers();
  if (cookie !== undefined) headers.set("cookie", `${COOKIE_NAME}=${cookie}`);
  return new NextRequest(`https://example.test${path}`, { method, headers });
}

describe("proxy gates /api/admin/*", () => {
  it.each([
    "/api/admin/import",
    "/api/admin/songs/1",
    "/api/admin/setlist-items/swap",
    "/api/admin/artists",
  ])("rejects %s without a session", async (path) => {
    const res = await proxy(req(path));
    expect(res.status).toBe(401);
  });

  it("rejects the old hard-coded cookie value", async () => {
    const res = await proxy(req("/api/admin/import", "opensetlist_admin_v1"));
    expect(res.status).toBe(401);
  });

  it("lets a valid session through to the route", async () => {
    const res = await proxy(req("/api/admin/import", token));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("leaves the login endpoint open", async () => {
    const res = await proxy(req("/api/admin/login"));
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("hands every non-admin path to the i18n middleware", async () => {
    const res = await proxy(req("/ko/songs/1", undefined, "GET"));
    expect(res.status).toBe(299);
  });
});
