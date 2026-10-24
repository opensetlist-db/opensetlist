#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { createState, documentSnapshot, encode, heartbeat, transition } from "./session-state/model.mjs";
import { initialize, readState, render, update } from "./session-state/store.mjs";

const usage = `Usage: node scripts/session-state.mjs <command> --file <state.json> [options]
  init       --config <task.json> [--dry-run]
  show
  read       --document <id> [--root <directory>]
  apply      --revision <n> --event <event.json> [--root <directory>] [--dry-run]
  heartbeat  --revision <n> --session <id> [--root <directory>] [--dry-run]
  render     --revision <n> --kind handoff|board --out <file.md>
             --expected-hash <sha256|missing> [--dry-run]
Document paths resolve relative to --root (default: state file directory).
Read emits the entire document and its hash; ack-read is an explicit operator assertion.
See docs/session-state.md for schema, transitions and automation template.`;

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, strict: true, options: {
    file: { type: "string" }, config: { type: "string" }, root: { type: "string" },
    revision: { type: "string" }, event: { type: "string" }, session: { type: "string" },
    document: { type: "string" }, kind: { type: "string" }, out: { type: "string" },
    "expected-hash": { type: "string" }, "dry-run": { type: "boolean", default: false }, help: { type: "boolean" },
  } });
  if (values.help) { console.log(usage); process.exit(0); }
  if (positionals.length !== 1 || !values.file) throw new Error(usage);
  const command = positionals[0];
  const allowed = {
    init: ["config", "dry-run"], show: [], read: ["document", "root"],
    apply: ["revision", "event", "root", "dry-run"], heartbeat: ["revision", "session", "root", "dry-run"],
    render: ["revision", "kind", "out", "expected-hash", "dry-run"],
  };
  if (!allowed[command] || Object.keys(values).some((key) => key !== "file" && values[key] !== false && !allowed[command].includes(key))) throw new Error("Unknown command or inapplicable option");
  const required = (name) => {
    if (!values[name]) throw new Error(`Missing --${name}`);
    return values[name];
  };
  const file = path.resolve(values.file);
  const root = path.resolve(values.root ?? path.dirname(file));
  const revision = () => {
    const raw = required("revision");
    if (!/^(0|[1-9]\d*)$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new Error("Invalid revision");
    return Number(raw);
  };
  const dryRun = values["dry-run"];
  let result;
  switch (command) {
    case "init": result = initialize(file, createState(JSON.parse(fs.readFileSync(required("config"), "utf8"))), dryRun); break;
    case "show": result = readState(file); break;
    case "read": result = documentSnapshot(readState(file).state, required("document"), root); break;
    case "apply": {
      const event = JSON.parse(fs.readFileSync(required("event"), "utf8"));
      if (event.type === "heartbeat") throw new Error("Use the heartbeat command to receive its delta before checkpointing");
      result = update(file, revision(), (state) => transition(state, event, { root }), { dryRun });
      break;
    }
    case "heartbeat": {
      const id = required("session");
      const current = readState(file).state;
      if (current.revision !== revision()) throw new Error("Revision conflict; reload current state");
      const preview = heartbeat(current, id, root);
      if (current.progress === "done" || current.sessions.find((entry) => entry.id === id).checkpoint === preview.checkpoint) {
        const publicReport = { ...preview };
        delete publicReport.checkpoint;
        result = { revision: current.revision, dryRun, ...publicReport };
        break;
      }
      let report;
      const next = update(file, revision(), (state) => {
        report = heartbeat(state, id, root);
        return transition(state, { type: "heartbeat", sessionId: id }, { root });
      }, { dryRun });
      const publicReport = { ...report };
      delete publicReport.checkpoint;
      result = { revision: next.revision, dryRun, ...publicReport };
      break;
    }
    case "render": result = { dryRun, content: render(file, revision(), path.resolve(required("out")),
      required("expected-hash"), required("kind"), dryRun) }; break;
  }
  process.stdout.write(encode(result));
} catch (error) {
  console.error("session-state: %s", error.message);
  process.exitCode = 1;
}
