#!/usr/bin/env node
// Offline draft inspection only; no dotenv, database, storage or network calls.
import path from "node:path";
import { realpath } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { installTypeScriptResolver } from "./ts-runtime.mjs";

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== "--in" || args[2] !== "--out") throw new Error("arguments");
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const output = path.resolve(args[3]);
  const parent = await realpath(path.dirname(output));
  const publicRoot = await realpath(path.join(root, "public"));
  const relative = path.relative(publicRoot, parent);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) throw new Error("public_output_refused");
  installTypeScriptResolver(root);
  const { openPreviewArchive } = await import(pathToFileURL(path.join(root, "src/lib/eventOg/previewArchive.ts")).href);
  await openPreviewArchive(path.resolve(args[1]), path.join(parent, path.basename(output)), process.env.EVENT_CARD_PREVIEW_ENCRYPTION_KEY ?? "");
  console.log(JSON.stringify({ status: "decrypted", output }));
}
main().catch(() => { console.error(JSON.stringify({ status: "failed", code: "preview_decryption_failed" })); process.exitCode = 1; });
