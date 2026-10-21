import { attemptConflict, type UploadError } from "./errors";
import type { ImageStorage, PutImmutableInput, PutResult } from "./storage";

/**
 * In-memory storage with the same write-once semantics as the R2 one, for
 * tests (and local experiments without R2). Never selected by
 * getImageStorage(); deliberately not exported from the module index.
 */
export class MemoryImageStorage implements ImageStorage {
  readonly keyPrefix: string;
  readonly objects = new Map<string, { bytes: Uint8Array; contentType: string; sha256: string }>();
  /** Every key a write was attempted for, including failed ones. */
  readonly puts: string[] = [];
  /** Set to make the next writes fail like an unreachable bucket. */
  failWith: UploadError | null = null;

  constructor(
    keyPrefix = "test",
    private readonly publicBaseUrl = "https://images.test.invalid",
  ) {
    this.keyPrefix = keyPrefix;
  }

  publicUrlFor(key: string): string {
    return `${this.publicBaseUrl}/${key}`;
  }

  async putImmutable({ key, bytes, contentType, sha256 }: PutImmutableInput): Promise<PutResult> {
    this.puts.push(key);
    if (this.failWith) throw this.failWith;
    const existing = this.objects.get(key);
    if (existing) {
      if (existing.sha256 === sha256) return "already-present";
      throw attemptConflict();
    }
    this.objects.set(key, { bytes, contentType, sha256 });
    return "created";
  }
}
