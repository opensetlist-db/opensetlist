import { parseRequiredAnonId } from "@/lib/anonId";
import { revalidateBoardAggregate } from "@/lib/dataCache";
import {
  ballotErrorResponse,
  ballotJson,
  checkBoardWritable,
} from "@/lib/board/ballot";
import { parseDecimalId } from "@/lib/board/ids";
import { deletePick, isPickIdShape } from "@/lib/board/picks";

type RouteProps = { params: Promise<{ id: string; pickId: string }> };

/**
 * Remove one of the caller's expected-song picks (n15).
 *
 *   DELETE /api/events/[id]/board/picks/[pickId]
 *     body { anonId }
 *     → 200 { id }
 *
 * The pick id is a path segment (matches the wish / impression DELETE
 * convention); the anon id rides in the body so it stays out of access
 * logs' URLs.
 *
 *   400 malformed event id / pick id / body / anonId
 *   404 event missing; no such pick on this event (also the answer to a
 *       retried delete — the client treats it as "already gone")
 *   403 board disabled; at or after start time; another anon's pick
 *   503 database busy before the write started
 *
 * A pick whose song was soft-deleted stays removable. Only the board
 * aggregate is expired after commit (see the create route).
 */
export async function DELETE(req: Request, { params }: RouteProps) {
  const { id, pickId } = await params;
  const eventId = parseDecimalId(id);
  if (eventId === null) return ballotJson(400, { error: "invalid_event_id" });
  if (!isPickIdShape(pickId)) {
    return ballotJson(400, { error: "invalid_pick_id" });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return ballotJson(400, { error: "invalid_body" });
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return ballotJson(400, { error: "invalid_body" });
  }
  const anon = parseRequiredAnonId((body as Record<string, unknown>).anonId);
  if (!anon.ok) return ballotJson(400, { error: "invalid_anon_id" });

  try {
    const control = await checkBoardWritable(eventId);
    if (!control.ok) return ballotJson(control.status, { error: control.code });
    const result = await deletePick(eventId, anon.value, pickId);
    revalidateBoardAggregate(eventId);
    return ballotJson(200, result);
  } catch (err) {
    return ballotErrorResponse(err);
  }
}
