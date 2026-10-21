import { AwsClient } from "aws4fetch";
import { UploadError } from "./errors";

// Object storage behind admin image uploads: Cloudflare R2 through its
// S3-compatible API, signed server-side with aws4fetch (SigV4 over
// fetch — no AWS SDK, no credentials in the browser).
//
// Immutability: every write is a conditional PUT (`If-None-Match: *`), so
// an object key, once written, can never be replaced — not by a retry,
// not by a second request reusing the attempt id with other bytes. A
// rejected precondition (412) is resolved by comparing the SHA-256 we
// stored as object metadata: same bytes → the earlier write of this very
// attempt landed (e.g. its response was lost) and is reused; other bytes
// → `attempt_conflict`.
//
// Nothing here deletes. Ordinary replacement/unlink keeps objects, a DB
// failure after a successful PUT leaves an unassigned object (acknowledged
// outcome, logged with its key), and permanent removal is a separate,
// explicitly approved operational task.
//
// Configuration (server-only env, all required to enable uploads):
//   R2_ACCOUNT_ID         Cloudflare account id (S3 endpoint host)
//   R2_ACCESS_KEY_ID      R2 API token key id, scoped to the bucket
//   R2_SECRET_ACCESS_KEY  its secret
//   R2_BUCKET             bucket name
//   R2_PUBLIC_BASE_URL    https origin (+ optional path) that serves the
//                         bucket publicly — the ONLY source of publicUrl
//   R2_KEY_PREFIX         namespace for this deployment's objects, e.g.
//                         `prod`, `dev`, `test` — keeps test objects apart

export type PutResult = "created" | "already-present";

export type PutImmutableInput = {
  key: string;
  bytes: Uint8Array;
  contentType: string;
  sha256: string;
};

export interface ImageStorage {
  /** Namespace every key of this storage starts with. */
  readonly keyPrefix: string;
  /** Trusted public delivery URL for a key. */
  publicUrlFor(key: string): string;
  /** Write once; see the immutability note above. */
  putImmutable(input: PutImmutableInput): Promise<PutResult>;
}

export type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl: string;
  keyPrefix: string;
};

const KEY_PREFIX_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const ACCOUNT_ID_RE = /^[a-f0-9]{32}$/;
const BUCKET_RE = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

/**
 * Reads and checks the R2 settings. Returns null when uploads are not
 * configured at all (every variable absent); throws when they are only
 * partly or wrongly configured, so a typo is not mistaken for "off".
 * Error messages name variables, never values.
 */
export function readR2Config(env: Record<string, string | undefined> = process.env): R2Config | null {
  const raw = {
    accountId: env.R2_ACCOUNT_ID?.trim(),
    accessKeyId: env.R2_ACCESS_KEY_ID?.trim(),
    secretAccessKey: env.R2_SECRET_ACCESS_KEY?.trim(),
    bucket: env.R2_BUCKET?.trim(),
    publicBaseUrl: env.R2_PUBLIC_BASE_URL?.trim(),
    keyPrefix: env.R2_KEY_PREFIX?.trim(),
  };
  const present = Object.values(raw).filter(Boolean).length;
  if (present === 0) return null;
  const missing = Object.entries(raw)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length > 0) {
    throw new Error(`R2 storage is partly configured; missing: ${missing.join(", ")}`);
  }
  const cfg = raw as R2Config;
  if (!ACCOUNT_ID_RE.test(cfg.accountId)) throw new Error("R2_ACCOUNT_ID is malformed");
  if (!BUCKET_RE.test(cfg.bucket)) throw new Error("R2_BUCKET is malformed");
  if (!KEY_PREFIX_RE.test(cfg.keyPrefix)) throw new Error("R2_KEY_PREFIX is malformed");
  let base: URL;
  try {
    base = new URL(cfg.publicBaseUrl);
  } catch {
    throw new Error("R2_PUBLIC_BASE_URL is not a URL");
  }
  if (base.protocol !== "https:" || base.search || base.hash || base.username) {
    throw new Error("R2_PUBLIC_BASE_URL must be a plain https URL");
  }
  return { ...cfg, publicBaseUrl: base.toString().replace(/\/+$/, "") };
}

/** Key path segments are URL-safe by construction (see keys.ts). */
function joinUrl(base: string, key: string): string {
  return `${base}/${key}`;
}

export class R2ImageStorage implements ImageStorage {
  readonly keyPrefix: string;
  private readonly client: AwsClient;
  private readonly endpoint: string;
  private readonly publicBaseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: R2Config, fetchImpl: typeof fetch = fetch) {
    this.keyPrefix = config.keyPrefix;
    this.publicBaseUrl = config.publicBaseUrl;
    this.endpoint = `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}`;
    this.fetchImpl = fetchImpl;
    // retries: 0 — aws4fetch would otherwise retry 5xx up to 10 times with
    // backoff inside one admin request. Resubmission is the client's call
    // (bounded, same attempt id), which the conditional PUT makes safe.
    this.client = new AwsClient({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      service: "s3",
      region: "auto",
      retries: 0,
    });
  }

  publicUrlFor(key: string): string {
    return joinUrl(this.publicBaseUrl, key);
  }

  async putImmutable({ key, bytes, contentType, sha256 }: PutImmutableInput): Promise<PutResult> {
    const url = joinUrl(this.endpoint, key);
    const put = await this.send(url, {
      method: "PUT",
      body: bytes as BodyInit,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "public, max-age=31536000, immutable",
        "If-None-Match": "*",
        "x-amz-meta-sha256": sha256,
      },
    });
    if (put.ok) return "created";
    if (put.status !== 412) throw storageFailure(put.status);

    // The key exists. Same content → an earlier write of this attempt.
    const head = await this.send(url, { method: "HEAD" });
    if (!head.ok) throw storageFailure(head.status);
    if (head.headers.get("x-amz-meta-sha256") === sha256) return "already-present";
    throw new UploadError(
      "attempt_conflict",
      "같은 업로드 시도 ID로 다른 파일이 이미 저장되어 있습니다. 파일을 다시 선택해 주세요.",
    );
  }

  private async send(url: string, init: RequestInit): Promise<Response> {
    let signed: Request;
    try {
      signed = await this.client.sign(url, init);
    } catch (cause) {
      throw new UploadError("storage_failed", "저장소 요청을 준비하지 못했습니다.", { cause });
    }
    try {
      const res = await this.fetchImpl(signed);
      // Drain the (small XML) body so the connection can be reused; its
      // content is never echoed back — R2 error bodies carry request ids
      // we log via status only.
      await res.arrayBuffer().catch(() => undefined);
      return res;
    } catch (cause) {
      throw new UploadError(
        "storage_failed",
        "저장소에 연결하지 못했습니다. 기존 이미지는 그대로입니다. 잠시 후 다시 시도해 주세요.",
        { cause },
      );
    }
  }
}

function storageFailure(status: number): UploadError {
  return new UploadError(
    "storage_failed",
    "이미지 저장에 실패했습니다. 기존 이미지는 그대로입니다. 잠시 후 다시 시도해 주세요.",
    { detail: { storageStatus: status } },
  );
}

/**
 * The deployment's storage, or `storage_not_configured` when R2 env is
 * absent (an actionable 503 for the admin, not a crash).
 */
export function getImageStorage(env: Record<string, string | undefined> = process.env): ImageStorage {
  let config: R2Config | null;
  try {
    config = readR2Config(env);
  } catch (cause) {
    throw new UploadError(
      "storage_not_configured",
      "이미지 저장소 설정이 올바르지 않습니다. 운영자에게 R2 환경 변수를 확인해 달라고 요청하세요.",
      { cause },
    );
  }
  if (!config) {
    throw new UploadError(
      "storage_not_configured",
      "이미지 저장소(R2)가 아직 설정되지 않아 업로드할 수 없습니다. 외부 URL 입력은 계속 사용할 수 있습니다.",
    );
  }
  return new R2ImageStorage(config);
}

/**
 * In-memory storage with the same write-once semantics, for tests and
 * local development without R2. Never selected automatically.
 */
export class MemoryImageStorage implements ImageStorage {
  readonly keyPrefix: string;
  readonly objects = new Map<string, { bytes: Uint8Array; contentType: string; sha256: string }>();
  readonly puts: string[] = [];
  /** Set to make the next writes fail like an unreachable bucket. */
  failWith: UploadError | null = null;

  constructor(keyPrefix = "test", private readonly publicBaseUrl = "https://images.test.invalid") {
    this.keyPrefix = keyPrefix;
  }

  publicUrlFor(key: string): string {
    return joinUrl(this.publicBaseUrl, key);
  }

  async putImmutable({ key, bytes, contentType, sha256 }: PutImmutableInput): Promise<PutResult> {
    this.puts.push(key);
    if (this.failWith) throw this.failWith;
    const existing = this.objects.get(key);
    if (existing) {
      if (existing.sha256 === sha256) return "already-present";
      throw new UploadError("attempt_conflict", "같은 업로드 시도 ID로 다른 파일이 이미 저장되어 있습니다.");
    }
    this.objects.set(key, { bytes, contentType, sha256 });
    return "created";
  }
}
