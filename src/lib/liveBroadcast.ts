import type { Prisma } from "@/generated/prisma/client";

/**
 * n14 live path — transactional "setlist changed" notification.
 *
 * Contract: every setlist-affecting save runs in ONE interactive
 * transaction that
 *
 *   1. locks the Event row (`lockEvent`) before reading anything it
 *      will base a write on (positions, existing rows, encore order),
 *   2. performs its mutations,
 *   3. increments `Event.setlistRevision` and calls `realtime.send`
 *      (`bumpSetlistRevisionAndBroadcast`), and
 *   4. commits — after which the caller expires the event's cached
 *      reads with `revalidateEventData(eventId)`.
 *
 * Why the lock: two concurrent saves on the same event (operator
 * double-click, two admins, insert-after racing a PUT) would otherwise
 * both read the same positions and both compute the same revision. The
 * row lock serializes same-event writers under Read Committed, so
 * revisions are strictly +1 per save and positions are read after the
 * previous save committed. Different events never contend.
 *
 * Why `realtime.send` inside the transaction: the message is an INSERT
 * into `realtime.messages`, which the Realtime service picks up from
 * WAL only after commit. So a rolled-back save never notifies, and a
 * committed save notifies exactly once — no "notified but not saved"
 * and no outbox table. `realtime.send` is plpgsql with an inner
 * `EXCEPTION WHEN OTHERS → RAISE WARNING`, so an ordinary broadcast
 * failure degrades to a missing notification (the clients' periodic
 * poll repairs it) instead of rolling back the operator's save.
 *
 * Reactions and wishes never call this — they are frequent and the
 * snapshot's periodic refresh carries them.
 */

/**
 * Whether the broadcast goes to a PRIVATE channel (Realtime
 * Authorization via the `event_broadcast_receive` RLS policy in
 * prisma/post-deploy.sql) or a public one.
 *
 * Pending the private-channel admission probe (task n14, "Private-channel
 * admission probe"): `true` is the intended mode; if the probe shows the
 * Realtime Authorization pool cannot admit ~500 joins in time, this
 * flips to `false` BEFORE R1 ships. It must not change between R1 and
 * R2 — R2 clients subscribe in this same mode, and an R2→R1 rollback
 * with a different mode would leave R2 tabs deaf.
 */
export const LIVE_BROADCAST_PRIVATE = true;

/** Broadcast topic for one event. The client channel name must match. */
export const liveTopic = (eventId: bigint | number | string): string =>
  `event:${eventId.toString()}`;

/** Broadcast event name inside the topic. */
export const LIVE_BROADCAST_EVENT = "rev";

type Tx = Prisma.TransactionClient;

/**
 * `SELECT id FROM "Event" WHERE id = $1 FOR UPDATE` — must be the first
 * statement of every setlist writer's transaction (see module comment).
 * Returns false when the event does not exist, so callers can 404
 * without having mutated anything.
 */
export async function lockEvent(tx: Tx, eventId: bigint): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: bigint }[]>`
    SELECT id FROM "Event" WHERE id = ${eventId} FOR UPDATE
  `;
  return rows.length > 0;
}

/**
 * Increment the event's setlist revision and enqueue the broadcast, in
 * the caller's transaction. Call it AFTER the mutations (the lock from
 * `lockEvent` is already held, so the UPDATE never waits) and only when
 * something actually changed. Returns the new revision.
 *
 * Both statements are tagged-template `$queryRaw` (parameterized — the
 * topic and payload are bind values, never interpolated into SQL text).
 *
 * The payload carries `rev` as a JSON number: revisions are tiny in
 * practice, and a client compares numbers. The safe-integer check is a
 * tripwire, not a realistic limit.
 */
export async function bumpSetlistRevisionAndBroadcast(
  tx: Tx,
  eventId: bigint,
): Promise<bigint> {
  const rows = await tx.$queryRaw<{ setlistRevision: bigint }[]>`
    UPDATE "Event"
       SET "setlistRevision" = "setlistRevision" + 1
     WHERE id = ${eventId}
     RETURNING "setlistRevision"
  `;
  if (rows.length === 0) {
    // The caller locked the row in this transaction, so this only
    // happens when a writer skipped `lockEvent` for a missing event.
    // Throwing rolls the save back rather than committing a change
    // nobody is told about.
    throw new Error(`bumpSetlistRevision: event ${eventId} not found`);
  }
  const rev = BigInt(rows[0].setlistRevision);
  const revNumber = Number(rev);
  if (!Number.isSafeInteger(revNumber)) {
    throw new Error(`bumpSetlistRevision: revision ${rev} exceeds 2^53`);
  }
  const payload = JSON.stringify({ rev: revNumber, kind: "setlist" });
  // `$executeRaw` (not `$queryRaw`): `realtime.send` returns `void`,
  // and the query engine has no deserializer for a void column — we
  // only need the statement to run. The `::jsonb` cast is on the bind
  // parameter so the payload is never spliced into SQL text.
  await tx.$executeRaw`
    SELECT realtime.send(
      ${payload}::jsonb,
      ${LIVE_BROADCAST_EVENT},
      ${liveTopic(eventId)},
      ${LIVE_BROADCAST_PRIVATE}
    )
  `;
  return rev;
}

/** Revision → JSON number for API responses (asserts safe integer). */
export function revToNumber(rev: bigint): number {
  const n = Number(rev);
  if (!Number.isSafeInteger(n)) {
    throw new Error(`setlistRevision ${rev} is not a safe integer`);
  }
  return n;
}
