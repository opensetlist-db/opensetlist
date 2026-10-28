// @vitest-environment node
import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from "node:fs/promises";
import { createHash, createCipheriv, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { openPreviewArchive, sealPreviewDirectory } from "@/lib/eventOg/previewArchive";

const secret = "a".repeat(64);
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
describe("private preview artifact boundary", () => {
  it("round-trips actual PNG/evidence/manifest bytes, refuses overwrite and authenticates before creating output", async () => {
    const folder = await mkdtemp(path.join(tmpdir(), "og05-archive-"));
    try {
      const source = path.join(folder, "source"); await mkdir(source); await mkdir(path.join(source, "packet"));
      const png = await readFile("public/apple-touch-icon.png");
      const manifest = JSON.stringify({ file: "card.png", sha256: sha(png), title: "Private draft title 日本語" });
      await writeFile(path.join(source, "packet/card.png"), png);
      await writeFile(path.join(source, "packet/manifest.json"), manifest);
      await writeFile(path.join(source, "owner-selection.json"), "Private draft selection");
      const archive = path.join(folder, "preview.enc"); await sealPreviewDirectory(source, archive, secret);
      const sealed = await readFile(archive);
      expect(sealed.includes(Buffer.from(manifest))).toBe(false);
      expect(sealed.includes(png)).toBe(false);
      const output = path.join(folder, "output"); await openPreviewArchive(archive, output, secret);
      expect(sha(await readFile(path.join(output, "packet/card.png")))).toBe(sha(png));
      expect(await readFile(path.join(output, "packet/manifest.json"), "utf8")).toBe(manifest);
      expect(await readFile(path.join(output, "owner-selection.json"), "utf8")).toBe("Private draft selection");
      await expect(openPreviewArchive(archive, output, secret)).rejects.toThrow();
      await expect(openPreviewArchive(archive, path.join(folder, "wrong-key"), "b".repeat(64))).rejects.toThrow();
      sealed[sealed.length - 1] ^= 1; const corrupt = path.join(folder, "corrupt.enc"); await writeFile(corrupt, sealed);
      await expect(openPreviewArchive(corrupt, path.join(folder, "tampered"), secret)).rejects.toThrow();
      await expect(access(path.join(folder, "tampered"))).rejects.toThrow();
      await expect(access(path.join(folder, "wrong-key"))).rejects.toThrow();

      // Real process: only an env key, no dotenv/DB connection or public output.
      const cli = spawnSync(process.execPath, ["scripts/event-og-preview-decrypt.mjs", "--in", archive, "--out", path.join(folder, "cli")],
        { encoding: "utf8", timeout: 10000, env: { ...process.env, EVENT_CARD_PREVIEW_ENCRYPTION_KEY: secret } });
      expect(cli.status, cli.stderr).toBe(0); expect(JSON.parse(cli.stdout).status).toBe("decrypted");
      expect(sha(await readFile(path.join(folder, "cli/packet/card.png")))).toBe(sha(png));
      const refused = spawnSync(process.execPath, ["scripts/event-og-preview-decrypt.mjs", "--in", archive, "--out", path.resolve("public/og05-must-not-exist")],
        { encoding: "utf8", timeout: 10000, env: { ...process.env, EVENT_CARD_PREVIEW_ENCRYPTION_KEY: secret } });
      expect(refused.status).toBe(1); expect(refused.stdout).toBe(""); expect(refused.stderr).not.toContain(secret);
    } finally { await rm(folder, { recursive: true, force: true }); }
  });
  it("rejects authenticated traversal, duplicate files and file/directory collisions before extraction", async () => {
    const folder = await mkdtemp(path.join(tmpdir(), "og05-invalid-archive-"));
    try {
      const valid = path.join(folder, "valid"); await mkdir(valid); await writeFile(path.join(valid, "control.txt"), "control");
      await sealPreviewDirectory(valid, path.join(folder, "valid.enc"), secret);
      await openPreviewArchive(path.join(folder, "valid.enc"), path.join(folder, "valid-output"), secret);
      expect(await readFile(path.join(folder, "valid-output/control.txt"), "utf8")).toBe("control");
      for (const [index, names] of [["../escape"], ["/absolute"], ["C:\\escape"], ["same", "same"], ["folder", "folder/file"]].entries()) {
        const header = Buffer.from("OSETOG01"); const nonce = randomBytes(12);
        const cipher = createCipheriv("aes-256-gcm", Buffer.from(secret, "hex"), nonce); cipher.setAAD(header);
        const encrypted = Buffer.concat([cipher.update(JSON.stringify(names.map((name) => ({ path: name, bytes: "eA==" })))), cipher.final()]);
        const archive = path.join(folder, `${index}.enc`); const output = path.join(folder, `output-${index}`);
        await writeFile(archive, Buffer.concat([header, nonce, cipher.getAuthTag(), encrypted]));
        await expect(openPreviewArchive(archive, output, secret)).rejects.toThrow();
        await expect(access(output)).rejects.toThrow();
      }
    } finally { await rm(folder, { recursive: true, force: true }); }
  });
  it("keeps production secrets and plaintext drafts away from install/third-party action steps", async () => {
    const workflow = (await readFile(".github/workflows/event-card-ops.yml", "utf8")).replace(/\r\n/g, "\n");
    const [job, steps] = workflow.split("    steps:\n");
    const verify = steps.split("      - name: Verify owner request")[1].split("      - name: Download")[0];
    const execute = steps.split("      - name: Execute one explicitly selected operation")[1].split("      - name: Retain encrypted preview")[0];
    expect(verify).toContain("secrets.PROD_DATABASE_URL_UNPOOLED");
    expect(execute).toContain("secrets.PROD_DATABASE_URL_UNPOOLED");
    expect(execute).toContain("secrets.R2_SECRET_ACCESS_KEY");
    expect(execute).toContain("secrets.EVENT_CARD_PREVIEW_ENCRYPTION_KEY");
    expect(job).not.toContain("secrets.");
    expect(steps.split("      - name: Verify owner request")[0]).not.toContain("secrets.");
    expect(workflow).toContain("environment: EventCardProduction");
    expect(workflow).toContain("cancel-in-progress: false");
    const uses = [...workflow.matchAll(/uses: (\S+)/g)].map((match) => match[1]);
    expect(uses.length).toBe(4); expect(uses.every((value) => /@[a-f0-9]{40}$/.test(value))).toBe(true);
    const upload = steps.split("      - name: Retain encrypted preview")[1];
    expect(upload).toContain("path: ${{ runner.temp }}/event-card-artifacts");
    expect(upload).not.toContain("secrets."); expect(upload).not.toContain("/event-card-ops");
  });
});
