import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLiveSnapshot } from "@/hooks/useLiveSnapshot";
import type { LiveFetchOutcome, LiveFetchRequest } from "@/lib/liveScheduler";

// The runner behind both live hooks, driven directly: URL building from
// the scheduler's request descriptor, and the mapping of
// `x-snapshot-verify` + body `rev` onto the scheduler outcome (hint
// contract — see snapshotAcceptance.ts / liveScheduler.ts).

const T0 = "2026-11-14T07:30:00.000Z";
const T1 = "2026-11-14T07:30:01.000Z";

function response(rev: number, verify?: string, capturedAt = T1) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(verify === undefined ? {} : { "x-snapshot-verify": verify }),
    json: async () => ({
      items: [{ id: `rev${rev}` }],
      reactionCounts: {},
      top3Wishes: [],
      status: "ongoing",
      rev,
      capturedAt,
      servedAt: capturedAt,
    }),
  };
}

function mount(initialRev = 5) {
  return renderHook(() =>
    useLiveSnapshot<{ id: string }>({
      eventId: "1",
      locale: "ko",
      initialItems: [],
      initialReactionCounts: {},
      initialTop3Wishes: [],
      initialRev,
      initialCapturedAt: T0,
    }),
  );
}

const generic: LiveFetchRequest = { reason: "periodic", generic: true, hint: null, notify: false };
const ride = (hint: number): LiveFetchRequest => ({
  reason: "periodic",
  generic: true,
  hint,
  notify: false,
});
const notification = (hint: number): LiveFetchRequest => ({
  reason: "notification",
  generic: false,
  hint,
  notify: true,
});
const recheck = (hint: number): LiveFetchRequest => ({
  reason: "recheck",
  generic: false,
  hint,
  notify: false,
});

describe("useLiveSnapshot runner — R2 hint contract", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function run(
    hook: ReturnType<typeof mount>,
    request: LiveFetchRequest,
  ): Promise<LiveFetchOutcome> {
    const runner = hook.result.current.createRunner();
    let outcome: LiveFetchOutcome | null = null;
    await act(async () => {
      outcome = await runner.runFetch(request.reason, request);
    });
    return outcome!;
  }

  it("builds the URL from the descriptor", async () => {
    fetchMock.mockResolvedValue(response(5, "satisfied"));
    const hook = mount(5);
    await run(hook, generic);
    await run(hook, ride(9));
    await run(hook, notification(9));
    await run(hook, recheck(9));
    await run(hook, notification(3)); // below serverRev → serverRev
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      "/api/setlist?eventId=1&locale=ko&minRev=5",
      "/api/setlist?eventId=1&locale=ko&minRev=9",
      "/api/setlist?eventId=1&locale=ko&minRev=9&hint=1",
      "/api/setlist?eventId=1&locale=ko&minRev=9",
      "/api/setlist?eventId=1&locale=ko&minRev=5&hint=1",
    ]);
  });

  it("accepts schedule changes with the snapshot and rejects stale or invalid timing", async () => {
    const hook = mount(5);
    const read = async (rev: number, startTime?: string) => {
      fetchMock.mockResolvedValue(new Response(JSON.stringify({
        items: [], status: "upcoming", rev, capturedAt: T1, startTime,
      })));
      await run(hook, generic);
    };
    await read(6, "2026-11-14T09:00:00Z");
    expect(hook.result.current.data.startTime).toBe("2026-11-14T09:00:00Z");
    await read(5, "2026-11-14T08:00:00Z");
    expect(hook.result.current.data.startTime).toBe("2026-11-14T09:00:00Z");
    await read(7, "invalid");
    await read(8);
    expect(hook.result.current.data.startTime).toBe("2026-11-14T09:00:00Z");
  });

  it("a request without a descriptor is the plain maintenance request", async () => {
    fetchMock.mockResolvedValue(response(5, "satisfied"));
    const hook = mount(5);
    const runner = hook.result.current.createRunner();
    await act(async () => {
      await runner.runFetch("periodic");
    });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/setlist?eventId=1&locale=ko&minRev=5");
  });

  it("body rev ≥ H → satisfied (resolved) whatever the header, applied, live", async () => {
    fetchMock.mockResolvedValue(response(9, "memo=4;age=100"));
    const hook = mount(5);
    expect(await run(hook, notification(9))).toEqual({ kind: "ok", hint: "resolved" });
    expect(hook.result.current.data.rev).toBe(9);
    expect(hook.result.current.data.freshness.state).toBe("live");
  });

  it("fresh dbRev < H → disproved (resolved), healthy, no failure", async () => {
    fetchMock.mockResolvedValue(response(5, "fresh=5"));
    const hook = mount(5);
    expect(await run(hook, notification(Number.MAX_SAFE_INTEGER))).toEqual({
      kind: "ok",
      hint: "resolved",
    });
    expect(hook.result.current.data.freshness.state).toBe("live");
  });

  it("memo / deferred / missing (R1 rollback) / malformed → inconclusive, counting zero failures", async () => {
    const hook = mount(5);
    for (const verify of ["memo=5;age=200", "deferred", undefined, "fresh=abc", "satisfied"]) {
      fetchMock.mockResolvedValueOnce(response(5, verify));
      expect(await run(hook, notification(6))).toEqual({ kind: "ok", hint: "inconclusive" });
      expect(hook.result.current.data.freshness.state).toBe("live");
    }
    // Five inconclusive answers in a row never reach "retrying"/"delayed".
    expect(hook.result.current.data.freshness.lastSyncAt).toBeInstanceOf(Date);
  });

  it("an R1 server (no header, a response without a ticket) is a plain healthy sync", async () => {
    fetchMock.mockResolvedValue(response(5));
    const hook = mount(5);
    expect(await run(hook, generic)).toEqual({ kind: "ok" });
  });

  it("fresh dbRev > body rev → server-proven gap: failed (retry path), ticket resolved, next minRev = dbRev", async () => {
    fetchMock.mockResolvedValueOnce(response(5, "fresh=7"));
    const hook = mount(5);
    const outcome = await run(hook, notification(9));
    expect(outcome).toMatchObject({ kind: "failed", hint: "resolved" });
    expect(hook.result.current.data.freshness.state).toBe("retrying");
    fetchMock.mockResolvedValueOnce(response(7, "satisfied"));
    await run(hook, generic);
    expect(fetchMock.mock.calls[1][0]).toBe("/api/setlist?eventId=1&locale=ko&minRev=7");
    expect(hook.result.current.data.rev).toBe(7);
    expect(hook.result.current.data.freshness.state).toBe("live");
  });

  it("an HTTP failure reports no hint verdict (the ticket rides on the retry) and keeps the Retry-After floor", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      headers: new Headers({ "Retry-After": "3" }),
      json: async () => ({}),
    });
    const hook = mount(5);
    const outcome = await run(hook, notification(9));
    expect(outcome).toEqual({ kind: "failed", retryInMs: 3_000, notBeforeMs: 3_000 });
  });

  it("noteHint / captureHint expose the acceptance batch (duplicates do no work)", () => {
    const hook = mount(5);
    const runner = hook.result.current.createRunner();
    expect(runner.noteHint(5)).toBe(false);
    expect(runner.noteHint("6")).toBe(false);
    expect(runner.noteHint(6)).toBe(true);
    expect(runner.noteHint(8)).toBe(true);
    expect(runner.captureHint()).toBe(8);
    expect(runner.captureHint()).toBeNull();
  });
});

// A 404 from `/api/setlist` means the event is missing or soft-deleted.
// The runner must hand the scheduler a terminal `gone` — never a
// `failed` (which would be retried with backoff forever) — and expose
// `gone` without touching the content or the failure bookkeeping.
describe("useLiveSnapshot runner — 404 is terminal (gone)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const notFound = () => ({
    ok: false,
    status: 404,
    headers: new Headers({ "x-snapshot-source": "cache" }),
    json: async () => ({ error: "not_found" }),
  });

  async function runOnce(hook: ReturnType<typeof mount>, request: LiveFetchRequest) {
    const runner = hook.result.current.createRunner();
    let outcome: LiveFetchOutcome | null = null;
    await act(async () => {
      outcome = await runner.runFetch(request.reason, request);
    });
    return outcome!;
  }

  it("404 → { kind: 'gone' }, gone=true, no failure counted, last content kept", async () => {
    fetchMock.mockResolvedValueOnce(response(6, "satisfied"));
    const hook = mount(5);
    expect(await runOnce(hook, generic)).toEqual({ kind: "ok" });
    expect(hook.result.current.data.items).toEqual([{ id: "rev6" }]);

    const onFailure = vi.fn();
    fetchMock.mockResolvedValueOnce(notFound());
    const runner = hook.result.current.createRunner(onFailure);
    let outcome: LiveFetchOutcome | null = null;
    await act(async () => {
      outcome = await runner.runFetch("notification", notification(7));
    });
    expect(outcome).toEqual({ kind: "gone" });
    expect(onFailure).not.toHaveBeenCalled();
    const data = hook.result.current.data;
    expect(data.gone).toBe(true);
    // Content and the sync bookkeeping are left exactly as they were.
    expect(data.items).toEqual([{ id: "rev6" }]);
    expect(data.rev).toBe(6);
    expect(data.freshness.state).toBe("live");
  });

  it("a 404 is never a hint verdict and never reads the body", async () => {
    const json = vi.fn(async () => ({ error: "not_found" }));
    fetchMock.mockResolvedValueOnce({ ...notFound(), json });
    const hook = mount(5);
    expect(await runOnce(hook, notification(9))).toEqual({ kind: "gone" });
    expect(json).not.toHaveBeenCalled();
  });

  it("other non-OK statuses stay retryable failures (500 / 503 / 410 are not gone)", async () => {
    const hook = mount(5);
    for (const status of [500, 503, 410]) {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status,
        headers: new Headers({}),
        json: async () => ({}),
      });
      expect((await runOnce(hook, generic)).kind).toBe("failed");
    }
    expect(hook.result.current.data.gone).toBe(false);
  });

  it("gone resets on event change", async () => {
    fetchMock.mockResolvedValueOnce(notFound());
    const hook = renderHook(
      ({ eventId }: { eventId: string }) =>
        useLiveSnapshot<{ id: string }>({
          eventId,
          locale: "ko",
          initialItems: [],
          initialReactionCounts: {},
          initialTop3Wishes: [],
          initialRev: 5,
          initialCapturedAt: T0,
        }),
      { initialProps: { eventId: "1" } },
    );
    const runner = hook.result.current.createRunner();
    await act(async () => {
      await runner.runFetch("periodic", generic);
    });
    expect(hook.result.current.data.gone).toBe(true);
    hook.rerender({ eventId: "2" });
    expect(hook.result.current.data.gone).toBe(false);
  });
});
