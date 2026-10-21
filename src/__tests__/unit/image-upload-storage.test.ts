// @vitest-environment node
//
// R2 transport (ticket 08) with a recorded fetch: what is signed and sent,
// the write-once precondition, and how storage answers map to admin
// outcomes. This is a MOCK of R2 — it proves our request shape and error
// handling, not that a real bucket accepts it (see the gated smoke test in
// the integration suite for that).
import { describe, it, expect } from "vitest";
import {
  R2ImageStorage,
  MemoryImageStorage,
  readR2Config,
  getImageStorage,
  type R2Config,
} from "@/lib/imageUpload/storage";
import { UploadError } from "@/lib/imageUpload/errors";
import { buildObjectKey, parseAttemptId } from "@/lib/imageUpload/keys";

const CONFIG: R2Config = {
  accountId: "0123456789abcdef0123456789abcdef",
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
  bucket: "opensetlist-images",
  publicBaseUrl: "https://img.example.test",
  keyPrefix: "test",
};
const ENV = {
  R2_ACCOUNT_ID: CONFIG.accountId,
  R2_ACCESS_KEY_ID: CONFIG.accessKeyId,
  R2_SECRET_ACCESS_KEY: CONFIG.secretAccessKey,
  R2_BUCKET: CONFIG.bucket,
  R2_PUBLIC_BASE_URL: "https://img.example.test/",
  R2_KEY_PREFIX: "test",
};
const KEY = "test/series-logo/7/3f0c1d2e-4b5a-4c6d-8e7f-001122334455.png";
const BYTES = new Uint8Array([1, 2, 3, 4]);
const SHA = "a".repeat(64);

type Call = { method: string; url: string; headers: Headers };

function recorder(responses: Array<Response | Error>) {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL) => {
    const req = input as Request;
    calls.push({ method: req.method, url: req.url, headers: req.headers });
    const next = responses.shift();
    if (!next) throw new Error("unexpected request");
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return { calls, impl };
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(UploadError);
    return (e as UploadError).code;
  }
  return "resolved";
}

describe("R2ImageStorage.putImmutable", () => {
  it("sends one signed, conditional PUT to the bucket endpoint", async () => {
    const { calls, impl } = recorder([new Response(null, { status: 200 })]);
    const storage = new R2ImageStorage(CONFIG, impl);
    expect(await storage.putImmutable({ key: KEY, bytes: BYTES, contentType: "image/png", sha256: SHA })).toBe(
      "created",
    );
    expect(calls).toHaveLength(1);
    const [put] = calls;
    expect(put.method).toBe("PUT");
    expect(put.url).toBe(`https://${CONFIG.accountId}.r2.cloudflarestorage.com/${CONFIG.bucket}/${KEY}`);
    expect(put.headers.get("if-none-match")).toBe("*");
    expect(put.headers.get("x-amz-meta-sha256")).toBe(SHA);
    expect(put.headers.get("content-type")).toBe("image/png");
    expect(put.headers.get("cache-control")).toContain("immutable");
    // SigV4 header present; the secret itself never travels.
    const auth = put.headers.get("authorization") ?? "";
    expect(auth).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/auto\/s3\/aws4_request/);
    expect(auth).toContain("if-none-match");
    expect(auth).not.toContain(CONFIG.secretAccessKey);
  });

  it("reuses an existing object of the same attempt (412 + matching sha)", async () => {
    const { calls, impl } = recorder([
      new Response(null, { status: 412 }),
      new Response(null, { status: 200, headers: { "x-amz-meta-sha256": SHA } }),
    ]);
    const storage = new R2ImageStorage(CONFIG, impl);
    expect(await storage.putImmutable({ key: KEY, bytes: BYTES, contentType: "image/png", sha256: SHA })).toBe(
      "already-present",
    );
    expect(calls.map((c) => c.method)).toEqual(["PUT", "HEAD"]);
  });

  it("refuses to treat other bytes under the same key as this attempt", async () => {
    const { impl } = recorder([
      new Response(null, { status: 412 }),
      new Response(null, { status: 200, headers: { "x-amz-meta-sha256": "b".repeat(64) } }),
    ]);
    const storage = new R2ImageStorage(CONFIG, impl);
    expect(
      await codeOf(storage.putImmutable({ key: KEY, bytes: BYTES, contentType: "image/png", sha256: SHA })),
    ).toBe("attempt_conflict");
  });

  it("maps HTTP errors and network failures to storage_failed without retrying", async () => {
    const a = recorder([new Response("<Error/>", { status: 503 })]);
    expect(
      await codeOf(new R2ImageStorage(CONFIG, a.impl).putImmutable({ key: KEY, bytes: BYTES, contentType: "image/png", sha256: SHA })),
    ).toBe("storage_failed");
    expect(a.calls).toHaveLength(1);

    const b = recorder([new TypeError("fetch failed")]);
    expect(
      await codeOf(new R2ImageStorage(CONFIG, b.impl).putImmutable({ key: KEY, bytes: BYTES, contentType: "image/png", sha256: SHA })),
    ).toBe("storage_failed");
  });

  it("builds public URLs only from the configured base", () => {
    const storage = new R2ImageStorage(readR2Config(ENV)!);
    expect(storage.publicUrlFor(KEY)).toBe(`https://img.example.test/${KEY}`);
  });
});

describe("R2 configuration", () => {
  it("is off (null) when no variable is set, and an actionable 503 to the admin", async () => {
    expect(readR2Config({})).toBeNull();
    let err: unknown;
    try {
      getImageStorage({});
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(UploadError);
    expect((err as UploadError).code).toBe("storage_not_configured");
    expect((err as UploadError).status).toBe(503);
  });

  it("fails loudly on partial or malformed settings, naming variables not values", () => {
    expect(() => readR2Config({ ...ENV, R2_BUCKET: undefined })).toThrow(/missing: bucket/);
    expect(() => readR2Config({ ...ENV, R2_PUBLIC_BASE_URL: "http://img.example.test" })).toThrow(/https/);
    expect(() => readR2Config({ ...ENV, R2_KEY_PREFIX: "Prod/../x" })).toThrow(/R2_KEY_PREFIX/);
    try {
      readR2Config({ ...ENV, R2_ACCOUNT_ID: "nope" });
    } catch (e) {
      expect(String(e)).not.toContain(CONFIG.secretAccessKey);
    }
  });
});

describe("object keys", () => {
  it("are derived from validated parts only", () => {
    const attemptId = parseAttemptId(" 3F0C1D2E-4B5A-4C6D-8E7F-001122334455 ");
    expect(
      buildObjectKey({ prefix: "test", segment: "series-logo", targetId: BigInt(7), attemptId, ext: "png" }),
    ).toBe(KEY);
  });

  it("reject attempt ids that are not UUIDs (path tricks included)", () => {
    for (const bad of ["", "../../prod/x", "3f0c1d2e", null, 42]) {
      expect(() => parseAttemptId(bad)).toThrow(UploadError);
    }
  });
});

describe("MemoryImageStorage", () => {
  it("has the same write-once semantics as R2", async () => {
    const m = new MemoryImageStorage();
    const input = { key: KEY, bytes: BYTES, contentType: "image/png", sha256: SHA };
    expect(await m.putImmutable(input)).toBe("created");
    expect(await m.putImmutable(input)).toBe("already-present");
    expect(await codeOf(m.putImmutable({ ...input, sha256: "c".repeat(64) }))).toBe("attempt_conflict");
  });
});
