# State-driven heartbeat prompt template

Fill in STATE_FILE, DOCUMENT_ROOT, SESSION_ID, HANDOFF_FILE and BOARD_FILE
when an authorized monitor is created. Keep these operator paths in the local
saved prompt. Use a fresh SESSION_ID for a new chat and read its required
context in full before acknowledging document hashes. This template creates no
automation and grants no authority to contact another person or merge a PR.

On each run:

1. Run `show` against STATE_FILE and read its current task, PR identity, head,
   merge state, gates, retry budget, evidence refs and revision. Use the
   applicable repository instructions as authority. Resume only this chat's
   SESSION_ID; a new chat starts with empty read receipts.
2. Run `heartbeat` with that revision, SESSION_ID and DOCUMENT_ROOT. Read in
   full and explicitly acknowledge only documents reported unread/changed;
   stop dependent actions for unavailable context. On the first run, perform
   all required full reads. Read changed operational fields in `delta`; inspect
   `show` after an interrupted response. Stay quiet for unchanged or
   non-actionable state, including review rate limits before not-before.
3. Before external action, observe the PR's fresh remote state and record it
   using `observe-pr`. A merged or closed PR cancels scheduled retries and takes
   priority over a timer. Never infer review pass from green/skipped provider
   status. Record actual results and exact head/ref; report unrun reviews.
4. If and only if an already-authorized review retry is eligible, reread state,
   verify fresh remote open/head, then reserve it via `consume-retry` at the
   expected revision **before** issuing one external request. Failed dispatch
   still consumes the budget. Do not refund, reschedule or loop. Never retry a
   merged/closed PR or use stale head evidence. No external action is authorized
   solely by a `retryActions` entry.
5. Record actual device reports separately from automated desktop results.
   Preserve the owner's original evidence; distinguish performedAt from
   receivedAt and explicitly state unknown execution time. Complete only after
   the owner's merge and every configured current-head gate; no automatic merge.
6. Generate handoff and board managed sections from the same current revision,
   with expected destination hashes and dry-run inspection. Preserve manual
   history and other sessions' sections. Retry a conflicted render only after
   reloading its destination; never overwrite another writer's change.
7. Notify only on meaningful change, completion, failure or required owner
   action. Report actual executed checks, pending gates and used retry count.
   Follow the monitor's existing terminal/pause instructions after completion;
   do not invent a new persistent monitor or start another product task.
