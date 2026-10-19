import { parseRequiredAnonId } from "@/lib/anonId";
import {
  ballotErrorResponse,
  ballotJson,
  checkBoardWritable,
} from "@/lib/board/ballot";
import { parseDecimalId } from "@/lib/board/ids";
import { createPick, validatePickTarget } from "@/lib/board/picks";
import {
  assertPublishCaps,
  parsePublishPicks,
  publishPicks,
  validatePublishTargets,
} from "@/lib/board/publish";

type RouteProps = { params: Promise<{ id: string }> };

/**
 * Add an expected song to the caller's fan board ballot (n15).
 *
 *   POST /api/events/[id]/board/picks
 *     body { groupId: "<root artist id>", songId: "<base song id>",
 *            anonId: "<browser id>" }
 *     → 201 { id, groupId, songId, createdAt }   new pick
 *     → 200 { …same… }                           exact retry (same
 *                                                 anon, song AND group)
 *
 * Error contract (body `{ error: code }`, codes in `BoardPickErrorCode`):
 *   400 malformed id / body / anonId; group not on this board; song
 *       outside the chosen group's base catalog
 *   404 event or song missing (or soft-deleted)
 *   403 board disabled; at or after the event's start time (UTC)
 *   409 `cap_reached` (already 3 in this group);
 *       `group_conflict` (this song is already picked under another
 *       group — move = remove + add)
 *   503 database busy before the write started (safe to retry)
 *
 * Order: cheap parse → fresh control check (kill switch + lock) →
 * static target validation → ballot lock → ballot validation + insert.
 * Everything that depends on the anon's existing picks runs under the
 * advisory lock (`withBallotLock`), which is what makes the cap hold
 * under concurrent requests.
 *
 * Never calls a cache revalidate helper: the board aggregate is
 * TTL-only, and every cached read carries the global public-data tag
 * the live path shares.
 */
export async function POST(req: Request, { params }: RouteProps) {
  const eventId = parseDecimalId((await params).id);
  if (eventId === null) return ballotJson(400, { error: "invalid_event_id" });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return ballotJson(400, { error: "invalid_body" });
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return ballotJson(400, { error: "invalid_body" });
  }
  const { groupId: rawGroup, songId: rawSong, anonId: rawAnon } =
    body as Record<string, unknown>;

  const anon = parseRequiredAnonId(rawAnon);
  if (!anon.ok) return ballotJson(400, { error: "invalid_anon_id" });
  const groupId = parseDecimalId(rawGroup);
  if (groupId === null) return ballotJson(400, { error: "invalid_group" });
  const songId = parseDecimalId(rawSong);
  if (songId === null) return ballotJson(400, { error: "invalid_song" });

  try {
    const control = await checkBoardWritable(eventId);
    if (!control.ok) return ballotJson(control.status, { error: control.code });
    await validatePickTarget(control.context, groupId, songId);
    const result = await createPick(eventId, anon.value, groupId, songId);
    return ballotJson(result.created ? 201 : 200, result.pick);
  } catch (err) {
    return ballotErrorResponse(err);
  }
}

/**
 * Publish the caller's whole ballot at once (n15, "put on the
 * board" from the Predict tab): the given picks REPLACE the anon's
 * expected songs for this event, atomically.
 *
 *   PUT /api/events/[id]/board/picks
 *     body { anonId: "<browser id>",
 *            picks: [{ groupId: "<root artist id>",
 *                      songId: "<base song id>" }, …] }
 *     → 200 { picks: [{ id, groupId, songId, createdAt }, …] }
 *       the resulting ballot, oldest first. A pick kept from before
 *       (same song, same group) keeps its id and `createdAt`. `[]`
 *       clears the ballot.
 *
 * Error contract — the same codes as a single add, applied to the
 * whole set before anything is written (nothing is written on any
 * error; the previous set stands):
 *   400 malformed body / ids / anonId; `duplicate_song` (one song
 *       listed twice — a crossover counts under one group only); a
 *       group not on this board; a song outside its group's catalog
 *   404 event or a song missing (or soft-deleted)
 *   403 board disabled; at or after the event's start time (UTC)
 *   409 `cap_reached` (more than 3 picks for one group)
 *   503 database busy before the write started (safe to retry)
 *
 * Order mirrors POST: parse → fresh control check → static target
 * validation (400/404 before any 409, as a single add answers) → cap →
 * ballot lock (control re-check, then the diff).
 */
export async function PUT(req: Request, { params }: RouteProps) {
  const eventId = parseDecimalId((await params).id);
  if (eventId === null) return ballotJson(400, { error: "invalid_event_id" });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return ballotJson(400, { error: "invalid_body" });
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return ballotJson(400, { error: "invalid_body" });
  }
  const { anonId: rawAnon, picks: rawPicks } = body as Record<string, unknown>;

  const anon = parseRequiredAnonId(rawAnon);
  if (!anon.ok) return ballotJson(400, { error: "invalid_anon_id" });
  const parsed = parsePublishPicks(rawPicks);
  if (!parsed.ok) return ballotJson(400, { error: parsed.code });

  try {
    const control = await checkBoardWritable(eventId);
    if (!control.ok) return ballotJson(control.status, { error: control.code });
    await validatePublishTargets(control.context, parsed.picks);
    assertPublishCaps(parsed.picks);
    const picks = await publishPicks(eventId, anon.value, parsed.picks);
    return ballotJson(200, { picks });
  } catch (err) {
    return ballotErrorResponse(err);
  }
}
