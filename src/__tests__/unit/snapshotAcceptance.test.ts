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
      hintGap: false,
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

  describe("delayed only from server-observed gaps", () => {
    it("a hint-only gap is not a server gap (R2: hints never drive the indicator)", () => {
      const acc = new SnapshotAcceptance({ rev: 5, capturedAt: T0 });
      acc.noteHintRev(9);
      expect(acc.minRevToSend()).toBe(9);
      const v = acc.evaluate(acc.generation, { rev: 6, capturedAt: T1 });
      expect(v).toMatchObject({ apply: true, serverGap: false, hintGap: true });
    });

    it("a gap below a revision the server itself returned is a server gap", () => {
      const acc = new SnapshotAcceptance();
      acc.evaluate(acc.generation, { rev: 8, capturedAt: T1 });
      const v = acc.evaluate(acc.generation, { rev: 7, capturedAt: T2 });
      expect(v).toMatchObject({ apply: false, serverGap: true, hintGap: false });
    });

    it("hints are validated and satisfied once a response reaches them", () => {
      const acc = new SnapshotAcceptance({ rev: 5, capturedAt: T0 });
      acc.noteHintRev("99");
      acc.noteHintRev(-1);
      acc.noteHintRev(2 ** 60);
      expect(acc.minRevToSend()).toBe(5);
      acc.noteHintRev(7);
      acc.evaluate(acc.generation, { rev: 7, capturedAt: T1 });
      expect(acc.minRevToSend()).toBe(7);
      // Hint consumed: a later same-rev response is not a hint gap.
      expect(
        acc.evaluate(acc.generation, { rev: 7, capturedAt: T2 }),
      ).toMatchObject({ hintGap: false });
    });

    it("reset clears hints", () => {
      const acc = new SnapshotAcceptance({ rev: 1, capturedAt: T0 });
      acc.noteHintRev(50);
      acc.reset({ rev: 2, capturedAt: T0 });
      expect(acc.minRevToSend()).toBe(2);
    });
  });
});
