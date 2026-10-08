import { describe, it, expect, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { nextCreditOnPick } from "@/app/admin/events/SetlistBuilder";

const muse = { id: 1, type: "group" };
const aqours = { id: 2, type: "group" };
const hasunosora = { id: 3, type: "group" };
const cerise = { id: 4, type: "unit" };
const dollchestra = { id: 5, type: "unit" };
const kaho = { id: 6, type: "solo" };

const ids = (xs: { id: number }[]) => xs.map((a) => a.id);

describe("nextCreditOnPick", () => {
  it("group pick replaces a sticky group credit (μ's → Aqours)", () => {
    expect(ids(nextCreditOnPick([muse], aqours))).toEqual([aqours.id]);
  });

  it("group pick drops unit/solo credits too", () => {
    expect(ids(nextCreditOnPick([hasunosora, cerise, kaho], aqours))).toEqual([
      aqours.id,
    ]);
  });

  it("group pick on an empty credit", () => {
    expect(ids(nextCreditOnPick([], aqours))).toEqual([aqours.id]);
  });

  it("unit pick after a group is additive", () => {
    expect(ids(nextCreditOnPick([hasunosora], cerise))).toEqual([
      hasunosora.id,
      cerise.id,
    ]);
  });

  it("second unit pick is additive (unit collab)", () => {
    expect(ids(nextCreditOnPick([hasunosora, cerise], dollchestra))).toEqual([
      hasunosora.id,
      cerise.id,
      dollchestra.id,
    ]);
  });

  it("addGroup appends the group, keeping other groups but not units", () => {
    expect(
      ids(nextCreditOnPick([muse, cerise], aqours, { addGroup: true })),
    ).toEqual([muse.id, aqours.id]);
  });

  it("untyped pick is treated as non-group (additive)", () => {
    const untyped = { id: 9 };
    expect(ids(nextCreditOnPick([muse], untyped))).toEqual([muse.id, 9]);
  });
});
