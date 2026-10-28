import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const HEADER = Buffer.from("OSETOG01");
const LIMIT = 128 * 1024 * 1024;
const MAX_FILES = 512;
function invalid(): never { throw new Error("invalid_preview_archive"); }
function key(value: string) {
  if (!/^[a-f0-9]{64}$/.test(value)) invalid();
  return Buffer.from(value, "hex");
}
function safeName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length < 512
    && !/[\\:\u0000]/.test(value) && value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

/** The hosted runner retains plaintext only in its ephemeral temp directory.
 * Public-repository artifacts contain authenticated ciphertext, never drafts. */
export async function sealPreviewDirectory(source: string, output: string, secret: string) {
  const encryptionKey = key(secret);
  const files: { path: string; bytes: string }[] = []; let total = 0;
  async function visit(relative: string) {
    const directory = path.join(source, relative);
    if (!(await lstat(directory)).isDirectory() || (await lstat(directory)).isSymbolicLink()) invalid();
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (!safeName(name) || entry.isSymbolicLink()) invalid();
      if (entry.isDirectory()) { await visit(name); continue; }
      if (!entry.isFile() || files.length >= MAX_FILES) invalid();
      const bytes = await readFile(path.join(source, name)); total += bytes.length;
      if (total > LIMIT) invalid();
      files.push({ path: name, bytes: bytes.toString("base64") });
    }
  }
  await visit("");
  if (!files.length) invalid();
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, nonce, { authTagLength: 16 }); cipher.setAAD(HEADER);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(files), "utf8"), cipher.final()]);
  await writeFile(output, Buffer.concat([HEADER, nonce, cipher.getAuthTag(), ciphertext]), { flag: "wx", mode: 0o600 });
}

/** Authenticate and validate the entire packet before creating a new output
 * directory. No symlinks, absolute paths, duplicate paths or overwrite mode. */
export async function openPreviewArchive(input: string, output: string, secret: string) {
  const encryptionKey = key(secret);
  const stat = await lstat(input);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > LIMIT * 2) invalid();
  const bytes = await readFile(input);
  if (bytes.length < 36 || !bytes.subarray(0, HEADER.length).equals(HEADER)) invalid();
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey, bytes.subarray(8, 20), { authTagLength: 16 });
  decipher.setAAD(HEADER); decipher.setAuthTag(bytes.subarray(20, 36));
  const plain = Buffer.concat([decipher.update(bytes.subarray(36)), decipher.final()]);
  const files: unknown = JSON.parse(plain.toString("utf8"));
  if (!Array.isArray(files) || !files.length || files.length > MAX_FILES) invalid();
  const seen = new Set<string>(); let total = 0;
  const validated = files.map((file: unknown) => {
    if (!file || typeof file !== "object" || !("path" in file) || !("bytes" in file)
      || Object.keys(file).sort().join() !== "bytes,path" || !safeName(file.path) || seen.has(file.path)
      || typeof file.bytes !== "string") invalid();
    seen.add(file.path);
    const contents = Buffer.from(file.bytes, "base64");
    if (contents.toString("base64") !== file.bytes || (total += contents.length) > LIMIT) invalid();
    return { name: file.path, contents };
  });
  // Reject file/directory conflicts before writing anything.
  for (const file of validated) {
    const parts = file.name.split("/"); parts.pop();
    while (parts.length) { if (seen.has(parts.join("/"))) invalid(); parts.pop(); }
  }
  await mkdir(output, { mode: 0o700 });
  for (const file of validated) {
    const destination = path.join(output, file.name);
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await writeFile(destination, file.contents, { flag: "wx", mode: 0o600 });
  }
}
