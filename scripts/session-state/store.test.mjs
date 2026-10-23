import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createState, digest, encode, transition } from "./model.mjs";
import { atomicWrite, initialize, managedSection, readState, render, summary, update, withLock } from "./store.mjs";

const task = JSON.parse(fs.readFileSync(new URL("./fixtures/task.json", import.meta.url)));
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "session-store-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "state.json");
  initialize(file, createState(task));
  return { root, file, next: (state) => transition(state, { type: "start-session", sessionId: "session-one" }, { root }) };
}

test("CAS, dry-run and exclusive locks preserve state after conflicts", (t) => {
  const f = fixture(t);
  const initial = fs.readFileSync(f.file, "utf8");
  assert.equal(update(f.file, 0, f.next, { dryRun: true }).revision, 1);
  assert.equal(fs.readFileSync(f.file, "utf8"), initial);
  update(f.file, 0, f.next);
  assert.equal(readState(f.file).state.revision, 1);
  assert.notEqual(fs.readFileSync(f.file, "utf8"), initial);
  assert.throws(() => update(f.file, 0, f.next), /conflict/);
  withLock(f.file, () => assert.throws(() => update(f.file, 1, f.next), /EEXIST/));
  assert.equal(readState(f.file).state.sessions.length, 1);
  assert.equal(fs.existsSync(`${f.file}.lock`), false);
});

test("uncooperative concurrent editor is detected before replace, without a partial completion", (t) => {
  const f = fixture(t);
  const other = createState(task);
  other.updatedAt = "2026-10-23T05:30:00.000Z";
  const bytes = encode(other);
  assert.throws(() => update(f.file, 0, f.next, { beforeRename: () => fs.writeFileSync(f.file, bytes) }), /Concurrent/);
  assert.equal(fs.readFileSync(f.file, "utf8"), bytes);
  assert.equal(readState(f.file).state.progress, "in-progress");
  assert.deepEqual(fs.readdirSync(f.root), ["state.json"]);
});

test("failed write leaves original bytes intact and cleans temporary files", (t) => {
  const f = fixture(t);
  const before = fs.readFileSync(f.file, "utf8");
  assert.throws(() => atomicWrite(f.file, "partial", () => { throw new Error("injected disk failure"); }), /injected/);
  assert.equal(fs.readFileSync(f.file, "utf8"), before);
  assert.deepEqual(fs.readdirSync(f.root), ["state.json"]);
  atomicWrite(f.file, before.replace('"revision": 0', '"revision": 1'));
  assert.equal(readState(f.file).state.revision, 1);
});

test("atomic initialization never overwrites a competing creator", (t) => {
  const f = fixture(t);
  const newFile = path.join(f.root, "new.json");
  assert.throws(() => atomicWrite(newFile, "candidate", () => fs.writeFileSync(newFile, "other creator"), { createOnly: true }), /EEXIST/);
  assert.equal(fs.readFileSync(newFile, "utf8"), "other creator");
  fs.unlinkSync(newFile);
  atomicWrite(newFile, "candidate", undefined, { createOnly: true });
  assert.equal(fs.readFileSync(newFile, "utf8"), "candidate");
});

test("atomic replacement preserves POSIX mode and ownership", { skip: process.platform === "win32" }, (t) => {
  const f = fixture(t);
  fs.chmodSync(f.file, 0o644);
  const before = fs.statSync(f.file);
  atomicWrite(f.file, fs.readFileSync(f.file));
  const after = fs.statSync(f.file);
  assert.equal(after.mode, before.mode);
  assert.equal(after.uid, before.uid);
  assert.equal(after.gid, before.gid);
});

test("existing and dangling link destinations are both rejected", (t) => {
  const f = fixture(t);
  const alias = path.join(f.root, "alias.md");
  const linkType = process.platform === "win32" ? "junction" : "file";
  const target = process.platform === "win32" ? path.join(f.root, "linked-directory") : f.file;
  if (process.platform === "win32") fs.mkdirSync(target);
  try { fs.symlinkSync(target, alias, linkType); }
  catch (error) {
    if (process.platform === "win32" && error.code === "EPERM") { t.skip("Windows file-symlink privilege unavailable"); return; }
    throw error;
  }
  assert.throws(() => atomicWrite(alias, "summary"), /regular files/);
  assert.equal(fs.lstatSync(alias).isSymbolicLink(), true);
  fs.unlinkSync(alias);
  fs.symlinkSync(path.join(f.root, "missing.md"), alias, linkType);
  assert.equal(fs.existsSync(alias), false);
  assert.equal(fs.lstatSync(alias).isSymbolicLink(), true);
  assert.throws(() => render(f.file, 0, alias, "missing", "handoff"), /regular files/);
  assert.throws(() => atomicWrite(alias, "summary"), /regular files/);
  assert.throws(() => initialize(alias, createState(task)), /regular files/);
  assert.equal(fs.lstatSync(alias).isSymbolicLink(), true);
});

test("managed handoff and board use the same revision, preserving approval history and other tasks", (t) => {
  const f = fixture(t);
  const handoff = path.join(f.root, "handoff.md");
  const board = path.join(f.root, "board.md");
  const manual = "# Approval archive\nOwner explicitly approved fixture v1.\n";
  const other = "\n<!-- session-state:other-task:start -->\nOther session owns this.\n<!-- session-state:other-task:end -->\n";
  fs.writeFileSync(handoff, manual + other);
  const expected = digest(fs.readFileSync(handoff));
  const dry = render(f.file, 0, handoff, expected, "handoff", true);
  assert.match(dry, /revision 0/);
  assert.equal(fs.readFileSync(handoff, "utf8"), manual + other);
  render(f.file, 0, handoff, expected, "handoff");
  const generated = fs.readFileSync(handoff, "utf8");
  assert.equal(generated.startsWith(manual + other), true);
  assert.equal(generated, dry);
  render(f.file, 0, board, "missing", "board");
  assert.match(fs.readFileSync(board, "utf8"), /example-task \| 0 \| in-progress/);
  assert.throws(() => render(f.file, 0, handoff, expected, "handoff"), /hash conflict/);
  update(f.file, 0, f.next);
  assert.throws(() => render(f.file, 0, board, digest(fs.readFileSync(board)), "board"), /Revision conflict/);
  render(f.file, 1, handoff, digest(fs.readFileSync(handoff)), "handoff");
  const changed = fs.readFileSync(handoff, "utf8");
  assert.match(changed, /revision 1/);
  assert.equal(changed.startsWith(manual + other), true);
  assert.equal(changed.split("session-state:example-task:start").length, 2);
});

test("malformed marker, state alias and forged done cannot be rendered", (t) => {
  const f = fixture(t);
  const marker = "<!-- session-state:example-task:start -->";
  assert.throws(() => managedSection(marker, task.id, "body"), /Ambiguous/);
  const valid = managedSection("Owner history", task.id, "first");
  assert.match(managedSection(valid, task.id, "second"), /second/);
  assert.throws(() => managedSection(valid + marker, task.id, "third"), /Ambiguous/);
  assert.throws(() => render(f.file, 0, f.file, digest(fs.readFileSync(f.file)), "handoff"), /overwrite/);
  const state = readState(f.file).state;
  assert.match(summary(state, "handoff"), /in-progress/);
  fs.writeFileSync(f.file, encode({ ...state, progress: "done" }));
  assert.throws(() => readState(f.file), /incomplete/);
});
