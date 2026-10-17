import { describe, it, expect } from "vitest";
import {
  SnapshotAcceptance,
  isValidRev,
  parseCapturedAt,
  setlistSnapshotUrl,
  shouldApply,
} from "@/lib/snapshotAcceptance";

const T0 = "2026-11-14T07:30:00.000Z";
const T1 = "2026-11-14T07:30:01.000Z";
const T2 = "2026-11-14T07:30:02.000Z";
const ms = (iso: string) => Date.parse(iso);

describe("shouldApply — (rev, capturedAt) ordering", () => {
  it("applies anything when nothing is applied yet", () => {
    expect(shouldApply({ rev: 0, capturedAt: null }, { rev: null, capturedAt: null })).toBe(true);
  });

  it("a higher rev always wins, even with an older capturedAt", () => {
    expect(
      shouldApply({ rev: 5, capturedAt: ms(T0) }, { rev: 4, capturedAt: ms(T2) }),
    ).toBe(true);
  });

  it("a lower rev never wins, even with a newer capturedAt", () => {
    expect(
      shouldApply({ rev: 3, capturedAt: ms(T2) }, { rev: 4, capturedAt: ms(T0) }),
    ).toBe(false);
  });

  it("same rev: later-or-equal capturedAt applies, earlier is rejected", () => {
    const applied = { rev: 4, capturedAt: ms(T1) };
    expect(shouldApply({ rev: 4, capturedAt: ms(T2) }, applied)).toBe(true);
    expect(shouldApply({ rev: 4, capturedAt: ms(T1) }, applied)).toBe(true);
    expect(shouldApply({ rev: 4, capturedAt: ms(T0) }, applied)).toBe(false);
  });

  it("same rev with an unknown capturedAt on either side applies", () => {
    expect(shouldApply({ rev: 4, capturedAt: null }, { rev: 4, capturedAt: ms(T1) })).toBe(true);
    expect(shouldApply({ rev: 4, capturedAt: ms(T0) }, { rev: 4, capturedAt: null })).toBe(true);
  });
});

describe("validation", () => {
  it("isValidRev accepts non-negative safe integers only", () => {
    expect(isValidRev(0)).toBe(true);
    expect(isValidRev(42)).toBe(true);
    expect(isValidRev(Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(isValidRev(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
    expect(isValidRev(-1)).toBe(false);
    expect(isValidRev(1.5)).toBe(false);
    expect(isValidRev(NaN)).toBe(false);
    expect(isValidRev(Infinity)).toBe(false);
    expect(isValidRev("42")).toBe(false);
    expect(isValidRev(null)).toBe(false);
    expect(isValidRev(undefined)).toBe(false);
  });

  it("parseCapturedAt accepts ISO strings only", () => {
    expect(parseCapturedAt(T0)).toBe(ms(T0));
    expect(parseCapturedAt("not a date")).toBeNull();
    expect(parseCapturedAt("")).toBeNull();
    expect(parseCapturedAt(12345)).toBeNull();
    expect(parseCapturedAt(null)).toBeNull();
  });

  it("setlistSnapshotUrl appends minRev only for a valid rev", () => {
    expect(setlistSnapshotUrl("7", "ko", null)).toBe("/api/setlist?eventId=7&locale=ko");
    expect(setlistSnapshotUrl("7", "ko", 12)).toBe(
      "/api/setlist?eventId=7&locale=ko&minRev=12",
    );
    expect(setlistSnapshotUrl("7", "zh-CN", 0)).toBe(
      "/api/setlist?eventId=7&locale=zh-CN&minRev=0",
    );
    expect(setlistSnapshotUrl("7", "ko", -1)).toBe("/api/setlist?eventId=7&locale=ko");
  });
});

describe("SnapshotAcceptance", () => {
  it("seeds from SSR: an older first response cannot roll SSR back", () => {
    const acc = new SnapshotAcceptance({ rev: 10, capturedAt: T1 });
    expect(acc.minRevToSend()).toBe(10);
    const v = acc.evaluate(acc.generation, { rev: 9, capturedAt: T2 });
    expect(v).toMatchObject({ kind: "evaluated", apply: false, serverGap: true });
    expect(acc.applied).toEqual({ rev: 10, capturedAt: ms(T1) });
  });

  it("ignores invalid seeds (treated as unknown)", () => {
    const acc = new SnapshotAcceptance({ rev: -3, capturedAt: "garbage" });
    expect(acc.applied).toEqual({ rev: null, capturedAt: null });
    expect(acc.minRevToSend()).toBeNull();
    expect(
      acc.evaluate(acc.generation, { rev: 0, capturedAt: T0 }),
    ).toMatchObject({ apply: true, serverGap: false });
  });

  it("applies newer, rejects same-rev-older without flagging a gap", () => {
    const acc = new SnapshotAcceptance({ rev: 3, capturedAt: T1 });
    expect(acc.evaluate(acc.generation, { rev: 3, capturedAt: T0 })).toMatchObject({
      apply: false,
      serverGap: false,
    });
    expect(acc.evaluate(acc.generation, { rev: 3, capturedAt: T2 })).toMatchObject({
      apply: true,
      serverGap: false,
    });
    expect(acc.applied).toEqual({ rev: 3, capturedAt: ms(T2) });
    expect(acc.evaluate(acc.generation, { rev: 4, capturedAt: T0 })).toMatchObject({
      apply: true,
    });
    expect(acc.applied).toEqual({ rev: 4, capturedAt: ms(T0) });
    expect(acc.minRevToSend()).toBe(4);
  });

  it("one watermark across a polling ↔ realtime hand-over never moves backwards", () => {
    // The live page feeds realtime catch-ups AND disconnected polls
    // into this one instance: 10 (realtime) → 12 (poll) → 10 (stale
    // catch-up) → 11 (stale poll) → 12 later read.
    const acc = new SnapshotAcceptance({ rev: 9, capturedAt: T0 });
    const g = acc.generation;
    const applied: number[] = [];
    const feed = (rev: number, capturedAt: string) => {
      const v = acc.evaluate(g, { rev, capturedAt });
      if (v.kind === "evaluated" && v.apply) applied.push(rev);
      return v;
    };
    feed(10, T0);
    feed(12, T1);
    expect(feed(10, T2)).toMatchObject({ apply: false, serverGap: true });
    expect(feed(11, T2)).toMatchObject({ apply: false, serverGap: true });
    feed(12, T2);
    expect(applied).toEqual([10, 12, 12]);
    expect(acc.applied).toEqual({ rev: 12, capturedAt: ms(T2) });
  });

  it("generation scoping: a late response from the previous event/locale is discarded untouched", () => {
    const acc = new SnapshotAcceptance({ rev: 3, capturedAt: T0 });
    const oldGen = acc.generation;
    acc.reset({ rev: 1, capturedAt: T0 }); // navigated to another event
    expect(acc.generation).toBe(oldGen + 1);
    expect(acc.evaluate(oldGen, { rev: 99, capturedAt: T2 })).toEqual({
      kind: "stale-generation",
    });
    expect(acc.applied).toEqual({ rev: 1, capturedAt: ms(T0) });
    expect(acc.minRevToSend()).toBe(1);
  });

  it("compat: a v0.18.x response (no rev / capturedAt) applies and leaves the watermark alone", () => {
    const acc = new SnapshotAcceptance({ rev: 5, capturedAt: T1 });
    const v = acc.evaluate(acc.generation, { updatedAt: T2 } as never);
    expect(v).toEqual({
      kind: "evaluated",
      apply: true,
      version: null,
      serverGap: false,
      serverRevRaised: false,
      hint: "none",
    });
    expect(acc.applied).toEqual({ rev: 5, capturedAt: ms(T1) });

    const fresh = new SnapshotAcceptance();
    expect(fresh.evaluate(fresh.generation, {})).toMatchObject({ apply: true, version: null });
    expect(fresh.applied).toEqual({ rev: null, capturedAt: null });
  });

  it("an unsafe or malformed rev is treated as compat, never trusted", () => {
    const acc = new SnapshotAcceptance({ rev: 5, capturedAt: T1 });
    for (const bad of [Number.MAX_SAFE_INTEGER + 2, -1, 1.5, "6", NaN]) {
      const v = acc.evaluate(acc.generation, { rev: bad, capturedAt: T2 });
      expect(v).toMatchObject({ apply: true, version: null, serverGap: false });
    }
    expect(acc.applied.rev).toBe(5);
    expect(acc.minRevToSend()).toBe(5);
  });

  it("a rev-carrying response without capturedAt keeps the same-rev watermark", () => {
    const acc = new SnapshotAcceptance({ rev: 5, capturedAt: T1 });
    expect(acc.evaluate(acc.generation, { rev: 5 })).toMatchObject({ apply: true });
    expect(acc.applied).toEqual({ rev: 5, capturedAt: ms(T1) });
    expect(acc.evaluate(acc.generation, { rev: 6 })).toMatchObject({ apply: true });
    expect(acc.applied).toEqual({ rev: 6, capturedAt: null });
  });

  // R2 hint contract. These replace the R1 tests of `noteHintRev`
  // (a hint raised the durable `wantedRev` until a response reached it)
  // and of `notificationMinRev` (the `appliedRev + 1` guess): both are
  // gone — a hint is a transient, per-batch ticket and only
  // server-observed values enter `serverRev`.
  describe("hint contract — durable serverRev vs transient batch ticket", () => {
    const MISSING = { kind: "missing" } as const;

    it("a hint never raises serverRev / wantedRev / minRevToSend", () => {
      const acc = new SnapshotAcceptance({ rev: 5, capturedAt: T0 });
      expect(acc.noteHint(9)).toBe(true);
      expect(acc.serverRev).toBe(5);
      expect(acc.wantedRev).toBe(5);
      expect(acc.minRevToSend()).toBe(5);
      expect(acc.pendingHint).toBe(9);
    });

    it("noteHint validates, ignores revisions the server already showed, and keeps the batch max", () => {
      const acc = new SnapshotAcceptance({ rev: 5, capturedAt: T0 });
      for (const bad of ["99", -1, 1.5, 2 ** 60, NaN, null, undefined, {}]) {
        expect(acc.noteHint(bad)).toBe(false);
      }
      expect(acc.noteHint(5)).toBe(false); // already applied (duplicate / echo)
      expect(acc.noteHint(3)).toBe(false);
      expect(acc.pendingHint).toBeNull();
      expect(acc.noteHint(7)).toBe(true);
      expect(acc.noteHint(6)).toBe(true);
      expect(acc.pendingHint).toBe(7);
    });

    it("captureHint consumes the batch; payloads after a dispatch form the next batch", () => {
      const acc = new SnapshotAcceptance({ rev: 5, capturedAt: T0 });
      acc.noteHint(7);
      acc.noteHint(8);
      expect(acc.captureHint()).toBe(8);
      expect(acc.captureHint()).toBeNull();
      acc.noteHint(9);
      expect(acc.captureHint()).toBe(9);
    });

    it("captureHint drops a batch the server has meanwhile reached", () => {
      const acc = new SnapshotAcceptance({ rev: 5, capturedAt: T0 });
      acc.noteHint(7);
      acc.evaluate(acc.generation, { rev: 7, capturedAt: T1 });
      expect(acc.captureHint()).toBeNull();
    });

    it("minRevFor = max(serverRev, H)", () => {
      const acc = new SnapshotAcceptance({ rev: 5, capturedAt: T0 });
      expect(acc.minRevFor(9)).toBe(9);
      expect(acc.minRevFor(3)).toBe(5);
      expect(acc.minRevFor(null)).toBe(5);
      expect(new SnapshotAcceptance().minRevFor(4)).toBe(4);
      expect(new SnapshotAcceptance().minRevFor(null)).toBeNull();
    });

    it("an OLDER request completing cannot consume a NEWER batch", () => {
      const acc = new SnapshotAcceptance({ rev: 5, capturedAt: T0 });
      acc.noteHint(6);
      const ticketA = acc.captureHint(); // request A dispatched with H = 6
      acc.noteHint(7); // arrives while A is in flight → next batch
      // A answers rev 7 — it satisfies A's own ticket…
      expect(
        acc.evaluate(acc.generation, { rev: 6, capturedAt: T1 }, MISSING, ticketA),
      ).toMatchObject({ hint: "satisfied" });
      // …and leaves the newer batch for its own dispatch.
      expect(acc.pendingHint).toBe(7);
      expect(acc.captureHint()).toBe(7);
    });

    it("satisfied: body rev ≥ H, whatever the header says", () => {
      const acc = new SnapshotAcceptance({ rev: 5, capturedAt: T0 });
      for (const verify of [
        MISSING,
        { kind: "memo", rev: 1, ageMs: 10 } as const,
        { kind: "deferred" } as const,
        { kind: "fresh", dbRev: 2 } as const,
      ]) {
        expect(
          acc.evaluate(acc.generation, { rev: 6, capturedAt: T1 }, verify, 6),
        ).toMatchObject({ apply: true, serverGap: false, hint: "satisfied" });
      }
    });

    it("disproved: fresh dbRev < H → healthy, no gap, serverRev untouched by H", () => {
      const acc = new SnapshotAcceptance({ rev: 5, capturedAt: T0 });
      const v = acc.evaluate(
        acc.generation,
        { rev: 5, capturedAt: T1 },
        { kind: "fresh", dbRev: 5 },
        Number.MAX_SAFE_INTEGER,
      );
      expect(v).toMatchObject({
        apply: true,
        serverGap: false,
        serverRevRaised: false,
        hint: "disproved",
      });
      expect(acc.serverRev).toBe(5);
    });

    it("fresh dbRev > body rev raises serverRev → server gap (existing retry path)", () => {
      const acc = new SnapshotAcceptance({ rev: 5, capturedAt: T0 });
      // Hint 9, served 5, the server's own read saw 7: the hint is still
      // disproved (7 < 9), and 7 is a server-proven head to chase.
      const v = acc.evaluate(
        acc.generation,
        { rev: 5, capturedAt: T1 },
        { kind: "fresh", dbRev: 7 },
        9,
      );
      expect(v).toMatchObject({ serverGap: true, serverRevRaised: true, hint: "disproved" });
      expect(acc.serverRev).toBe(7);
      expect(acc.minRevToSend()).toBe(7);
      // A request without a ticket raises it the same way.
      const w = acc.evaluate(acc.generation, { rev: 6, capturedAt: T2 }, { kind: "fresh", dbRev: 8 });
      expect(w).toMatchObject({ serverGap: true, serverRevRaised: true, hint: "none" });
      expect(acc.serverRev).toBe(8);
    });

    it("superseded: the server itself proved a head ≥ H above the body → gap path, ticket consumed", () => {
      const acc = new SnapshotAcceptance({ rev: 5, capturedAt: T0 });
      const v = acc.evaluate(
        acc.generation,
        { rev: 5, capturedAt: T1 },
        { kind: "fresh", dbRev: 9 },
        8,
      );
      expect(v).toMatchObject({ serverGap: true, serverRevRaised: true, hint: "superseded" });
    });

    it("inconclusive: memo / deferred / missing / contradicting headers never refute and never raise", () => {
      for (const verify of [
        { kind: "memo", rev: 9, ageMs: 200 } as const,
        { kind: "deferred" } as const,
        MISSING,
        { kind: "none" } as const,
        { kind: "satisfied" } as const,
      ]) {
        const acc = new SnapshotAcceptance({ rev: 5, capturedAt: T0 });
        const v = acc.evaluate(acc.generation, { rev: 5, capturedAt: T1 }, verify, 6);
        expect(v).toMatchObject({ apply: true, serverGap: false, hint: "inconclusive" });
        // A memo revision is NOT server-proven (it may predate the save).
        expect(acc.serverRev).toBe(5);
      }
    });

    it("a compat body (no rev) leaves a carried ticket inconclusive", () => {
      const acc = new SnapshotAcceptance({ rev: 5, capturedAt: T0 });
      expect(acc.evaluate(acc.generation, {}, MISSING, 6)).toMatchObject({
        apply: true,
        version: null,
        hint: "inconclusive",
      });
    });

    it("poisoning drill: a max-safe-integer hint then honest saves — serverRev is never poisoned", () => {
      const acc = new SnapshotAcceptance({ rev: 5, capturedAt: T0 });
      const g = acc.generation;
      expect(acc.noteHint(Number.MAX_SAFE_INTEGER)).toBe(true);
      const forged = acc.captureHint();
      expect(forged).toBe(Number.MAX_SAFE_INTEGER);
      expect(acc.minRevFor(forged)).toBe(Number.MAX_SAFE_INTEGER);
      // First check: a memo answer (inconclusive) …
      expect(
        acc.evaluate(g, { rev: 5, capturedAt: T1 }, { kind: "memo", rev: 5, ageMs: 300 }, forged),
      ).toMatchObject({ serverGap: false, hint: "inconclusive" });
      // … the one recheck: deferred (inconclusive again → the scheduler
      // drops the ticket).
      expect(
        acc.evaluate(g, { rev: 5, capturedAt: T2 }, { kind: "deferred" }, forged),
      ).toMatchObject({ serverGap: false, hint: "inconclusive" });
      // Nothing durable moved.
      expect(acc.serverRev).toBe(5);
      expect(acc.minRevToSend()).toBe(5);
      // Honest saves after the drop work normally.
      expect(acc.noteHint(6)).toBe(true);
      const honest = acc.captureHint();
      expect(honest).toBe(6);
      expect(acc.minRevFor(honest)).toBe(6);
      expect(
        acc.evaluate(g, { rev: 6, capturedAt: T2 }, { kind: "satisfied" }, honest),
      ).toMatchObject({ apply: true, serverGap: false, hint: "satisfied" });
      expect(acc.minRevToSend()).toBe(6);
    });

    it("a gap below a revision the server itself returned is a server gap", () => {
      const acc = new SnapshotAcceptance();
      acc.evaluate(acc.generation, { rev: 8, capturedAt: T1 });
      const v = acc.evaluate(acc.generation, { rev: 7, capturedAt: T2 });
      expect(v).toMatchObject({ apply: false, serverGap: true, hint: "none" });
    });

    it("reset drops the pending batch", () => {
      const acc = new SnapshotAcceptance({ rev: 1, capturedAt: T0 });
      acc.noteHint(50);
      acc.reset({ rev: 2, capturedAt: T0 });
      expect(acc.pendingHint).toBeNull();
      expect(acc.captureHint()).toBeNull();
      expect(acc.minRevToSend()).toBe(2);
    });
  });

  it("setlistSnapshotUrl appends &hint=1 only for a notification fetch with a minRev", () => {
    expect(setlistSnapshotUrl("7", "ko", 12, true)).toBe(
      "/api/setlist?eventId=7&locale=ko&minRev=12&hint=1",
    );
    expect(setlistSnapshotUrl("7", "ko", 12, false)).toBe(
      "/api/setlist?eventId=7&locale=ko&minRev=12",
    );
    expect(setlistSnapshotUrl("7", "ko", null, true)).toBe("/api/setlist?eventId=7&locale=ko");
  });

  describe("adopt — hand-over from another live source", () => {
    it("raises the watermark without a new generation", () => {
      const acc = new SnapshotAcceptance({ rev: 3, capturedAt: T0 });
      const gen = acc.generation;
      acc.adopt({ rev: 7, capturedAt: T1 });
      expect(acc.generation).toBe(gen);
      expect(acc.applied).toEqual({ rev: 7, capturedAt: ms(T1) });
      expect(acc.minRevToSend()).toBe(7);
      // An older response is now a server-proven gap.
      expect(acc.evaluate(gen, { rev: 5, capturedAt: T2 })).toMatchObject({
        apply: false,
        serverGap: true,
      });
    });

    it("never lowers the watermark; ignores invalid input", () => {
      const acc = new SnapshotAcceptance({ rev: 9, capturedAt: T2 });
      acc.adopt({ rev: 4, capturedAt: T0 });
      acc.adopt({ rev: 9, capturedAt: T1 });
      acc.adopt({ rev: -1, capturedAt: T2 });
      acc.adopt({ rev: null, capturedAt: null });
      acc.adopt(undefined);
      expect(acc.applied).toEqual({ rev: 9, capturedAt: ms(T2) });
    });
  });
});

