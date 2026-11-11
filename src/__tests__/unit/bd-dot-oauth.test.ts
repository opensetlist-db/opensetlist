import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getClaims: vi.fn(),
  getBonusCheckQueue: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { getClaims: mocks.getClaims } }),
}));
vi.mock("@/lib/bonusChecks", () => ({ getBonusCheckQueue: mocks.getBonusCheckQueue }));

import { POST } from "@/app/api/bd-dot/mcp/route";
import { GET as getMetadata } from "@/app/.well-known/oauth-protected-resource/api/bd-dot/mcp/route";
import { DEV_PROJECT_REF } from "../../../scripts/dev-db-guard.mjs";

const origin = "https://opensetlist-bd-dot-oauth-opensetlist-projects.vercel.app";
const productionOrigin = "https://opensetlist.com";
const productionRef = "prjjgxjdbvooqjiiumew";
const productionIssuer = `https://${productionRef}.supabase.co/auth/v1`;
const issuer = `https://${DEV_PROJECT_REF}.supabase.co/auth/v1`;
const clientId = "chatgpt-dev-client";
const subject = "dev-test-user";
const validToken = "unit-test-token";
const currentTime = () => Math.floor(Date.now() / 1000);

function setClaims(overrides: Record<string, unknown> = {}) {
  const now = currentTime();
  mocks.getClaims.mockResolvedValue({
    data: { claims: {
      iss: issuer, aud: "authenticated", role: "authenticated", sub: subject,
      client_id: clientId, session_id: "dev-test-session", iat: now - 5, exp: now + 60, ...overrides,
    } },
    error: null,
  });
}

function rpc(method: string, params: unknown, token: string | null, host: string, requestOrigin?: string) {
  return POST(new Request(host + "/api/bd-dot/mcp", {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(requestOrigin ? { Origin: requestOrigin } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }));
}

function call(name = "list_bd_bonus_check_targets", token: string | null = validToken, host = origin) {
  return rpc("tools/call", { name }, token, host);
}

async function expectReadableQueue(host = origin) {
  const response = await call(undefined, undefined, host);
  const payload = await response.json();
  expect(JSON.parse(payload.result.content[0].text)).toMatchObject({ current: [], review: [] });
  expect(mocks.getBonusCheckQueue).toHaveBeenCalledTimes(1);
  mocks.getBonusCheckQueue.mockClear();
  mocks.getClaims.mockClear();
}

function configureProduction() {
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("DATABASE_URL", `postgresql://postgres.${productionRef}:example@aws-example.pooler.supabase.com:6543/postgres`);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", `https://${productionRef}.supabase.co`);
  vi.stubEnv("BD_DOT_OAUTH_ORIGIN", productionOrigin);
  vi.stubEnv("BD_DOT_OAUTH_CLIENT_ID", "chatgpt-prod-client");
  vi.stubEnv("BD_DOT_OAUTH_SUBJECT", "prod-test-user");
  setClaims({ iss: productionIssuer, client_id: "chatgpt-prod-client", sub: "prod-test-user" });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => {});
  mocks.getBonusCheckQueue.mockResolvedValue({ current: [], review: [], ended: [] });
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("DATABASE_URL", `postgresql://postgres:example@db.${DEV_PROJECT_REF}.supabase.co:5432/postgres`);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", `https://${DEV_PROJECT_REF}.supabase.co`);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "dev-anon-key");
  vi.stubEnv("BD_DOT_OAUTH_ORIGIN", origin);
  vi.stubEnv("BD_DOT_OAUTH_CLIENT_ID", clientId);
  vi.stubEnv("BD_DOT_OAUTH_SUBJECT", subject);
  vi.stubEnv("BD_DOT_OAUTH_REDIRECT_URI", "https://chatgpt.com/connector/oauth/test-callback");
  setClaims();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("BD OAuth tool", () => {
  it.each(["production", "development"])("is unavailable in %s with Preview configuration", async (environment) => {
    await expectReadableQueue();
    vi.stubEnv("VERCEL_ENV", environment);
    expect((await call()).status).toBe(404);
    expect(mocks.getBonusCheckQueue).not.toHaveBeenCalled();
  });

  it("is unavailable if Preview points to a different database", async () => {
    await expectReadableQueue();
    vi.stubEnv("DATABASE_URL", "postgresql://postgres:example@db.other-project.supabase.co:5432/postgres");
    expect((await call()).status).toBe(404);
    expect(mocks.getBonusCheckQueue).not.toHaveBeenCalled();
  });

  it("advertises OAuth discovery without reading the queue", async () => {
    await expectReadableQueue();
    const response = await call(undefined, null);
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("/.well-known/oauth-protected-resource/");
    expect(mocks.getBonusCheckQueue).not.toHaveBeenCalled();
  });

  it("offers OAuth refresh when the JWT verifier rejects an expired token", async () => {
    await expectReadableQueue();
    mocks.getClaims.mockRejectedValue(new Error("JWT expired"));
    const response = await call();
    expect(mocks.getClaims).toHaveBeenCalledWith(validToken);
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("resource_metadata=");
    expect(mocks.getBonusCheckQueue).not.toHaveBeenCalled();
  });

  it.each([
    { client_id: "unapproved" }, { sub: "another-user" }, { role: "service_role" },
    { aud: "another-resource" }, { iss: "https://another-issuer.example" }, { exp: 1 },
    { iat: 4_102_444_800 }, { iat: 1.5 }, { session_id: 123 },
  ])("denies mismatched verified claims %o", async (overrides) => {
    await expectReadableQueue();
    setClaims(overrides);
    expect((await call()).status).toBe(401);
    expect(mocks.getBonusCheckQueue).not.toHaveBeenCalled();
  });

  it("rejects a JWT verifier error response", async () => {
    await expectReadableQueue();
    mocks.getClaims.mockResolvedValue({ data: null, error: new Error("Invalid token") });
    expect((await call()).status).toBe(401);
    expect(mocks.getBonusCheckQueue).not.toHaveBeenCalled();
  });

  it("rejects an untrusted request origin before verifying the token", async () => {
    const params = { name: "list_bd_bonus_check_targets" };
    const trusted = await rpc("tools/call", params, validToken, origin, "https://chatgpt.com");
    expect(trusted.status).toBe(200);
    expect(mocks.getBonusCheckQueue).toHaveBeenCalledTimes(1);
    const blocked = await rpc("tools/call", params, validToken, origin, "https://another-origin.example");
    expect(blocked.status).toBe(403);
    expect(mocks.getClaims).toHaveBeenCalledTimes(1);
    expect(mocks.getBonusCheckQueue).toHaveBeenCalledTimes(1);
  });

  it("has no write tool", async () => {
    await expectReadableQueue();
    const list = await (await rpc("tools/list", {}, validToken, origin)).json();
    expect(list.result.tools).toEqual([
      expect.objectContaining({ name: "list_bd_bonus_check_targets", annotations: expect.objectContaining({ readOnlyHint: true }) }),
    ]);
    expect(await (await call("record_bd_bonus")).json()).toMatchObject({ error: { code: -32602 } });
    expect(mocks.getBonusCheckQueue).not.toHaveBeenCalled();
  });

  it("reports a read failure through MCP without exposing the database error", async () => {
    const logError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getBonusCheckQueue.mockRejectedValue(new Error("Private connection error"));
    const response = await call();
    const payload = await response.json();
    expect(mocks.getBonusCheckQueue).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledExactlyOnceWith(JSON.stringify({
      event: "bd_dot_read_failed", environment: "dev", error: "Error",
    }));
    expect(payload).toEqual({
      jsonrpc: "2.0", id: 1,
      result: { isError: true, content: [{ type: "text", text: "Unable to load BD check targets." }] },
    });
  });

  it("returns only active targets and emits a receipt without token or identity data", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const target = {
      originalBonusType: "Test benefit",
      listing: { album: { originalTitle: "Test album" }, originalStoreName: "Test store", originalEditionLabel: null },
      latestObservation: { summary: "Internal note" },
    };
    mocks.getBonusCheckQueue.mockResolvedValue({ current: [target], review: [], ended: [target] });
    const payload = await (await call()).json();
    const result = JSON.parse(payload.result.content[0].text);
    const evidence = JSON.parse(info.mock.calls[0][0]);
    expect(result).toMatchObject({
      environment: "dev",
      current: [{ album: "Test album", store: "Test store", edition: null, bonus: "Test benefit" }],
      review: [],
    });
    expect(Object.keys(result)).not.toContain("ended");
    expect(payload.result.content[0].text).not.toContain("Internal note");
    expect(evidence).toMatchObject({ event: "bd_dot_read", environment: "dev", receipt: result.receipt, current: 1, review: 0 });
    expect(info.mock.calls[0][0]).not.toMatch(/unit-test-token|dev-test-user|dev-test-session/);
  });

  it("uses the production OAuth issuer and queue only on the configured production host", async () => {
    configureProduction();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    mocks.getBonusCheckQueue.mockResolvedValue({ current: [], review: [], ended: [] });
    const metaPath = "/.well-known/oauth-protected-resource/api/bd-dot/mcp";
    const metadata = await getMetadata(new Request(productionOrigin + metaPath)).json();
    expect(metadata).toMatchObject({
      resource: productionOrigin + "/api/bd-dot/mcp",
      authorization_servers: [productionIssuer],
    });
    const result = await (await call(undefined, undefined, productionOrigin)).json();
    expect(JSON.parse(result.result.content[0].text)).toMatchObject({ environment: "production" });
    expect(mocks.getBonusCheckQueue).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(expect.stringContaining('"environment":"production"'));
    expect((await call()).status).toBe(404);
    expect(getMetadata(new Request(origin + metaPath)).status).toBe(404);
    vi.stubEnv("DATABASE_URL", `postgresql://postgres:example@db.${productionRef}.supabase.co:5432/postgres?host=other.example`);
    expect((await call(undefined, undefined, productionOrigin)).status).toBe(404);
    configureProduction();
    setClaims({ iss: issuer, client_id: "chatgpt-prod-client", sub: "prod-test-user" });
    expect((await call(undefined, undefined, productionOrigin)).status).toBe(401);
    expect(mocks.getBonusCheckQueue).toHaveBeenCalledTimes(1);
  });

  it("keeps production disabled until its explicit connection is configured", async () => {
    configureProduction();
    await expectReadableQueue(productionOrigin);
    vi.stubEnv("BD_DOT_OAUTH_SUBJECT", "");
    expect((await call(undefined, undefined, productionOrigin)).status).toBe(404);
    expect(mocks.getBonusCheckQueue).not.toHaveBeenCalled();
  });
});
