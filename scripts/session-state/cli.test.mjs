import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { digest } from "./model.mjs";

const cli = fileURLToPath(new URL("../session-state.mjs", import.meta.url));
const config = fileURLToPath(new URL("./fixtures/task.json", import.meta.url));
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "session-cli-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "state.json");
  fs.writeFileSync(path.join(root, "instructions.md"), "Read these fixture instructions in full.\n");
  const run = (command, ...args) => spawnSync(process.execPath, [cli, command, "--file", file, ...args], { encoding: "utf8" });
  const json = (command, ...args) => {
    const result = run(command, ...args);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const event = (value) => {
    const target = path.join(root, "event.json");
    fs.writeFileSync(target, JSON.stringify(value));
    return target;
  };
  json("init", "--config", config);
  return { root, file, run, json, event };
}

test("CLI restart resumes only its session, and unchanged heartbeats are read-only", (t) => {
  const f = fixture(t);
  f.json("apply", "--revision", "0", "--event", f.event({ type: "start-session", sessionId: "session-one" }));
  const first = f.json("heartbeat", "--revision", "1", "--session", "session-one");
  assert.equal(first.contextReady, false);
  assert.equal(first.documents[0].reason, "unread");
  const read = f.json("read", "--document", "instructions");
  assert.match(read.content, /Read these fixture instructions in full/);
  f.json("apply", "--revision", "2", "--event", f.event({ type: "ack-read", sessionId: "session-one", documentId: "instructions", sha256: read.sha256 }));
  const before = fs.readFileSync(f.file);
  const quiet = f.json("heartbeat", "--revision", "3", "--session", "session-one");
  assert.deepEqual(quiet.delta, {});
  assert.deepEqual(quiet.documents, []);
  assert.equal(quiet.revision, 3);
  assert.deepEqual(fs.readFileSync(f.file), before);
  fs.appendFileSync(path.join(f.root, "instructions.md"), "New instruction\n");
  const changed = f.json("heartbeat", "--revision", "3", "--session", "session-one");
  assert.equal(changed.documents[0].reason, "changed");
  assert.equal(changed.contextReady, false);
  assert.equal(f.run("apply", "--revision", "0", "--event", f.event({ type: "start-session", sessionId: "two" })).status, 1);
  assert.equal(f.run("show", "--event", "ignored.json").status, 1);
  assert.equal(f.run("show", "--unknown").status, 1);
  const beforeApplyHeartbeat = fs.readFileSync(f.file);
  assert.equal(f.run("apply", "--revision", "3", "--event", f.event({ type: "heartbeat", sessionId: "session-one" })).status, 1);
  assert.deepEqual(fs.readFileSync(f.file), beforeApplyHeartbeat);
});

test("CLI dry-run renders without writing and refuses stale destination edits", (t) => {
  const f = fixture(t);
  const out = path.join(f.root, "handoff.md");
  const args = ["--revision", "0", "--kind", "handoff", "--out", out, "--expected-hash", "missing"];
  const dry = f.json("render", ...args, "--dry-run");
  assert.match(dry.content, /example-task/);
  assert.equal(fs.existsSync(out), false);
  f.json("render", ...args);
  assert.equal(fs.readFileSync(out, "utf8"), dry.content);
  const expected = digest(fs.readFileSync(out));
  fs.appendFileSync(out, "Owner manual approval\n");
  const result = f.run("render", "--revision", "0", "--kind", "handoff", "--out", out, "--expected-hash", expected);
  assert.equal(result.status, 1);
  assert.match(fs.readFileSync(out, "utf8"), /Owner manual approval/);
});

test("two real writer processes with the same expected revision produce one winner", async (t) => {
  const f = fixture(t);
  const event = f.event({ type: "start-session", sessionId: "contender" });
  const writer = () => new Promise((resolve, reject) => {
    const process = spawn(globalThis.process.execPath, [cli, "apply", "--file", f.file, "--revision", "0", "--event", event], { stdio: "ignore" });
    process.on("error", reject);
    process.on("close", resolve);
  });
  const statuses = await Promise.all([writer(), writer()]);
  assert.deepEqual(statuses.sort(), [0, 1]);
  assert.equal(f.json("show").state.revision, 1);
  assert.equal(f.json("show").state.sessions.length, 1);
});
