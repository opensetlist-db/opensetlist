# Session state and heartbeat delta

`node scripts/session-state.mjs --help` is the command reference. This tool
keeps one operator-owned JSON file as the source for PR observations, explicit
checks/reviews, one retry budget per review, device attestations, evidence refs
and document read receipts. It uses Node built-ins and never accesses the app
database, GitHub, browser, credentials or a scheduler.

```text
read required documents in full → acknowledge exact hashes for this session
observe PR/checks/reviews/evidence → heartbeat returns changed fields/documents
reserve eligible retry → external request (only within existing authorization)
owner merge + required current-head evidence → complete
same revision → managed handoff + managed board summary
```

## Start and resume

Create a task config using `scripts/session-state/fixtures/task.json` as a shape
example. It is a synthetic fixture, independent of any historical approval or
completed task. List **every required context document**, including repository
instructions, applicable local instructions, the task/spec and relevant source
references; the tool cannot discover your workflow's mandatory reading list.
Document paths may be absolute, or relative to `--root` (default: state file
directory). Keep operator paths and state files outside tracked content, for
example in `.claude/tmp/session/`. Parent directories must already exist.

```powershell
node scripts/session-state.mjs init --file .claude/tmp/session/state.json --config .claude/tmp/session/task.json
node scripts/session-state.mjs apply --file .claude/tmp/session/state.json --revision 0 --event .claude/tmp/session/start.json
node scripts/session-state.mjs read --file .claude/tmp/session/state.json --document instructions
```

The start event is `{"type":"start-session","sessionId":"unique-chat-id"}`.
`read` returns the **entire** UTF-8 document and SHA-256 of its original bytes.
Read that output in full (split large output if your host truncates it). Then
write an event file with the returned hash and apply it at the latest revision:

```json
{
  "type": "ack-read",
  "sessionId": "unique-chat-id",
  "documentId": "instructions",
  "sha256": "replace-with-the-exact-64-character-sha256-returned-by-read"
}
```

An acknowledgement is an operator assertion, **not proof of human or model
comprehension**. Hashing, initializing or running a heartbeat never claims a
document was read. A hash mismatch rejects the receipt. Repeat for every listed
document. Each new chat uses a new session ID and performs the initial required
full reads, even when another session already read identical bytes. Resume the
same chat with its existing ID; never use another chat's ID to bypass context.
`show` returns the current state/revision and state-file hash for inspection.

```powershell
node scripts/session-state.mjs heartbeat --file .claude/tmp/session/state.json --revision 3 --session unique-chat-id
```

Heartbeat returns unread/changed/unavailable documents, `contextReady`, changed
operational fields in `delta`, eligible `retryActions`, and the next revision.
It returns no full document bodies. Reread and acknowledge each changed document
before dependent work. Missing files keep context unready. After the first
checkpoint, unchanged heartbeats return empty deltas and leave the file bytes
and revision untouched. A changed document stays pending until acknowledged;
seeing it in a heartbeat does not acknowledge it. Operational checkpoints
advance when a heartbeat persists; inspect its output before continuing. A
failed delivery can be recovered with `show`. Completed tasks support read-only
heartbeats for an existing session; `show` remains available to new chats.

## Version 1 schema

`scripts/session-state/schema.mjs` is the authoritative executable schema. All
fields are required, unknown fields fail, IDs use lowercase letters/digits and
hyphens, heads/merge commits are full lowercase 40-character Git SHAs, hashes
are full SHA-256, and times are UTC ISO strings ending in `Z`. Nullable values
must be supplied explicitly. `task` and its requirements are fixed at init;
create a separate state for a changed scope rather than weakening gates.

| Field | Meaning |
| --- | --- |
| `schemaVersion`, `revision`, `updatedAt` | Format 1; compare-and-swap revision; write timestamp |
| `task` | ID, PR target, document ID/path list, required check/review/attestation/evidence IDs |
| `progress` | `in-progress` until explicit `complete`; then immutable `done` |
| `pr` | null, or number, URL, head, open/closed/merged, nullable merge commit, observedAt, evidence ref |
| `checks` | ID, head, pending/pass/fail/skipped, ref, observedAt |
| `reviews` | ID, head, pending/pass/findings/skipped/rate-limited/unrun, unresolved count, ref, observedAt |
| `retries` | reviewId, used 0/1, notBefore, scheduled/consumed/cancelled, rate-limit ref |
| `attestations` | ID/head/result, reporter/device/os/browser/scope, performedAt/uncertainty note, receivedAt, ref |
| `evidence` | ID, head, ref, recordedAt |
| `sessions` | Unique chat ID, startedAt, explicit document receipts, heartbeat checkpoint |

Evidence refs are explicit nonempty references supplied by the operator; the
tool validates their presence and head, not the truth or availability of an
external log. Keep raw logs/manual approvals as separate immutable evidence.
For a tooling task without device testing, use an empty attestation requirement
list. Define the actual required independent reviews; a green provider status
or a skipped check never substitutes for an explicit review pass.

## Observation and transition events

All events are JSON files passed to `apply --revision N --event event.json`.
Use `--dry-run` to validate and inspect the proposed state without writing.
`show` supplies N; re-read it after conflicts rather than blindly retrying a
stale event. Events accept only the fields below and `type`.

| Type | Other fields |
| --- | --- |
| `start-session` | `sessionId` (new ID, empty receipts) |
| `ack-read` | `sessionId`, `documentId`, `sha256` |
| `observe-pr` | `pr` object matching the schema |
| `record-check`, `record-review`, `record-attestation`, `record-evidence` | `entry` object matching the corresponding schema |
| `schedule-retry` | `reviewId`, `notBefore`, `ref` |
| `consume-retry` | `sessionId`, `reviewId` |
| `complete` | `sessionId` |

Example check: `{"type":"record-check","entry":{"id":"unit","head":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","status":"pass","ref":"unit.log","observedAt":"2026-10-23T05:00:00.000Z"}}`.
An attestation distinguishes actual device execution time from when a message
arrived. If the owner says “just tested” without a measured device timestamp,
keep `performedAt: null` and a nonempty `performedAtNote`; record `receivedAt`
exactly. Preserve their report in `ref`. Name the actual device/browser; desktop
WebKit does not establish iOS execution. `performedAt` cannot follow receipt.

Observe fresh PR state **before** evaluating a retry. Merge/closed immediately
cancels scheduled retries. A head change also cancels a pending retry, and old
head results cannot satisfy completion. Reopening preserves the exhausted or
cancelled retry ledger. PR identity is fixed; stale PR/result timestamps and
future observations are rejected. A merged observation is terminal.

`schedule-retry` needs an open PR and an explicit current-head rate-limit
review. Supply the provider's reset time plus the workflow's required margin
as `notBefore`, retaining its source ref. Each review ID can be scheduled only
once per state, including across head changes and reopenings. A non-rate-limit
review result cancels its pending retry. At/after not-before, with context
current, `consume-retry` durably uses the budget **before** the external request.
If that request fails or the process crashes, the budget stays used; there is
no automatic refund or duplicate dispatch. A returned action is advisory and
does not send a message. Concurrent GitHub merge after an observation remains
possible: recheck remotely immediately before any external request.

`complete` requires merged PR/merge SHA, current document receipts and explicit
pass evidence for every configured current-head gate. Required review passes
must have zero unresolved findings. Unknown device execution time may be
reported honestly with its uncertainty note; it is not replaced by receipt
time. Completion validates recorded evidence, not ownership/authenticity of
the upstream merge. The operator must record the owner's actual merge.

## Safe managed summaries

`render --revision N --kind handoff|board --out destination.md
--expected-hash SHA` replaces only the current task's
`<!-- session-state:task-id:start -->` / `end` section, or appends one if absent.
Manual history, approval records and other tasks' sections stay byte-for-byte
outside that region. Malformed/duplicate markers fail. Use `missing` for a new
file; otherwise calculate the SHA-256 of the **whole destination file** before
rendering (`(Get-FileHash -Algorithm SHA256 destination.md).Hash.ToLower()`).
Dry-run returns proposed content without writes. Render handoff and board at
the same N; their revision labels make mixed-generation output visible. Paths
and refs in output are operator data: inspect before publishing outside the
local workflow, especially refs containing private paths.

Each file replacement uses a sibling temporary file, fsync, and atomic rename,
guarded by exclusive `.lock` creation, expected revision and whole-file hash
checks. State changes and destination changes detected before rename abort.
All writers must use this CLI to serialize the critical section: an unrelated
editor writing in the final hash-check/rename gap cannot be made transactional.
Use local filesystems with atomic same-directory rename support. Multi-file
publication is deliberately not one transaction: if board rendering fails,
the valid state/handoff persists and the stale board retains its old revision;
retry that render against current hashes. It never marks progress done.
The tool does not rewrite historical sections or recover by deleting files.

A process killed while holding a lock may leave its `.lock` and a temporary
file. Verify that exact lock PID is no longer running and no writer owns the
task before manually removing the lock; rerun `show` and inspect the original
state. No age-based lock stealing, automatic retries, scheduling or migration
of historical completed artifacts is performed.

## Automation template

Use [session-state-heartbeat.md](session-state-heartbeat.md) when an authorized
monitor is created or updated. Creating this tool/template itself schedules
nothing. The monitor reads the current state file on every run and carries no
cached PR number, head, retry count or device result in its prompt.

## Verify

```powershell
node --test scripts/session-state/*.test.mjs
npx eslint --max-warnings=0 --no-warn-ignored scripts/session-state.mjs scripts/session-state/*.mjs
```

Tests cover initial/resumed sessions, unchanged and changed/missing documents,
exact read receipts, one retry/not-before, merge/closed/head priority, skipped
reviews, missing completion evidence, device time uncertainty, stale revisions,
two real concurrent writers, interrupted writes, dry-run and preserved manual
history. They use isolated synthetic files and no network/database. Package
scripts, shared CI and unrelated QA tools are unchanged; run this suite
explicitly in addition to repository checks.
