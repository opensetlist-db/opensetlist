import { describe, it, expect, vi } from "vitest";
import {
  findReconciledRow,
  saveSetlistRow,
  type ReconcilableRow,
} from "@/app/admin/events/setlistSave";

function row(
  id: number,
  position: number,
  songIds: number[],
  note: string | null = null,
  type = "song",
): ReconcilableRow {
  return { id, position, type, note, songs: songIds.map((sid) => ({ song: { id: sid } })) };
}

const payload = { position: 5, type: "song", note: null, songIds: [101, 102] };
const before = [row(1, 1, [7]), row(2, 2, [8])];
const knownIds = new Set(before.map((r) => r.id));

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("findReconciledRow", () => {
  it("matches a new row on position + type + ordered songs + note", () => {
    const items = [...before, row(9, 5, [101, 102])];
    expect(findReconciledRow(items, payload, knownIds)?.id).toBe(9);
  });

  it("ignores a pre-existing identical row", () => {
    const items = [row(3, 5, [101, 102])];
    expect(findReconciledRow(items, payload, new Set([3]))).toBeUndefined();
  });

  it("song order and note must match", () => {
    expect(findReconciledRow([row(9, 5, [102, 101])], payload, knownIds)).toBeUndefined();
    expect(findReconciledRow([row(9, 5, [101, 102], "x")], payload, knownIds)).toBeUndefined();
  });

  it("unknown-song placeholder (no songs) matches by position + note", () => {
    const p = { ...payload, songIds: [], note: "곡 미상" };
    expect(findReconciledRow([row(9, 5, [], "곡 미상")], p, knownIds)?.id).toBe(9);
  });
});

describe("saveSetlistRow", () => {
  const base = { url: "/api/admin/setlist-items", payload, knownIds };

  it("rejected → server message, no reload", async () => {
    const reload = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(400, { error: "앙코르 순서 오류" }));
    const out = await saveSetlistRow({ ...base, method: "POST", reload, fetchImpl });
    expect(out).toEqual({ kind: "rejected", message: "앙코르 순서 오류" });
    expect(reload).not.toHaveBeenCalled();
  });

  it("rejected with a non-JSON body → generic message with status", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("<html>502</html>", { status: 502 }));
    const out = await saveSetlistRow({ ...base, method: "POST", reload: vi.fn(), fetchImpl });
    expect(out.kind).toBe("rejected");
    expect(out.kind === "rejected" && out.message).toContain("502");
  });

  it("fetch throws but the POST landed → saved via reconcile, single POST", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const after = [...before, row(9, 5, [101, 102])];
    const reload = vi.fn().mockResolvedValue(after);
    const onReconcileStart = vi.fn();
    const out = await saveSetlistRow({
      ...base, method: "POST", reload, fetchImpl, onReconcileStart,
    });
    expect(out).toEqual({ kind: "saved", items: after, reconciled: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(onReconcileStart).toHaveBeenCalledTimes(1);
  });

  it("fetch throws and the row is absent → unknown (retry is safe)", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const reload = vi.fn().mockResolvedValue(before);
    const out = await saveSetlistRow({ ...base, method: "POST", reload, fetchImpl });
    expect(out).toEqual({ kind: "unknown", items: before });
  });

  it("PUT that throws is never reconciled", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const after = [...before, row(9, 5, [101, 102])];
    const out = await saveSetlistRow({
      ...base, url: "/api/admin/setlist-items/9", method: "PUT",
      reload: vi.fn().mockResolvedValue(after), fetchImpl,
    });
    expect(out.kind).toBe("unknown");
  });

  it("write OK but reload failed → saved with items null (stale banner)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(201, { id: 9 }));
    const out = await saveSetlistRow({
      ...base, method: "POST", reload: vi.fn().mockResolvedValue(null), fetchImpl,
    });
    expect(out).toEqual({ kind: "saved", items: null, reconciled: false });
  });

  it("aborts a hung request after the timeout and reconciles", async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    ) as unknown as typeof fetch;
    const reload = vi.fn().mockResolvedValue(before);
    const out = await saveSetlistRow({
      ...base, method: "POST", reload, fetchImpl, timeoutMs: 20,
    });
    expect(out.kind).toBe("unknown");
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
