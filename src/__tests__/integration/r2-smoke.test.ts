import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { getImageStorage } from "@/lib/imageUpload/storage";
import { validateImage } from "@/lib/imageUpload/validate";

// Real-transport smoke test for the admin image storage (ticket 08). The
// mocked suites prove our request shape; only this proves that the actual
// bucket accepts a signed conditional PUT, enforces write-once, and serves
// the object at the configured public URL.
//
// Opt-in: runs only with R2_SMOKE=1 and the R2_* variables set, and only
// when R2_KEY_PREFIX is `test` — the namespace whose objects may be cleaned
// under the documented test-storage lifecycle. It writes exactly ONE small
// object per run and deletes nothing: objects are retained (record the key
// printed below in the ticket handoff's preservation list). No DB access.

const enabled = process.env.R2_SMOKE === "1";

describe.skipIf(!enabled)("R2 transport smoke (writes one object under test/)", () => {
  it("PUTs once, refuses to overwrite, and serves the bytes publicly", async () => {
    const storage = getImageStorage();
    expect(storage.keyPrefix, "R2_KEY_PREFIX must be `test` for the smoke run").toBe("test");

    const png = new Uint8Array(
      await sharp({ create: { width: 32, height: 32, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .png()
        .toBuffer(),
    );
    const image = await validateImage(png);
    const key = `test/smoke/${randomUUID()}.png`;
    // process.stdout.write, not console.info: vitest's default reporter
    // drops console.info (and test annotations) for a passing test, but
    // lets raw stdout through. Written before the first PUT so the key is
    // in the output even when a later assertion fails.
    process.stdout.write(`
[r2-smoke] writing ${key}
`);

    const put = { key, bytes: image.bytes, contentType: image.mimeType, sha256: image.sha256 };
    expect(await storage.putImmutable(put)).toBe("created");
    // Same attempt again → recognised, not rewritten.
    expect(await storage.putImmutable(put)).toBe("already-present");
    // Other bytes under the same key → refused by the precondition.
    await expect(storage.putImmutable({ ...put, sha256: "0".repeat(64) })).rejects.toMatchObject({
      code: "attempt_conflict",
    });

    const res = await fetch(storage.publicUrlFor(key));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await res.arrayBuffer()).equals(Buffer.from(png))).toBe(true);
  });
});
