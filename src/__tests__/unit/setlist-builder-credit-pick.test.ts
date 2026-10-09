import { describe, it, expect, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { nextCreditOnPick, stageTypeForCredit } from "@/app/admin/events/SetlistBuilder";

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

describe("stageTypeForCredit", () => {
  const nijigasaki = { id: 7, type: "group" };
  const ayumu = { id: 8, type: "solo" };
  const honoka = { id: 11, type: "solo" };
  const kotori = { id: 12, type: "solo" };

  it("group only → full_group", () => {
    expect(stageTypeForCredit([aqours], "unit")).toBe("full_group");
  });

  it("group + unit → unit (rehearsal D1 #8 CYaRon!)", () => {
    expect(stageTypeForCredit([aqours, cerise], "full_group")).toBe("unit");
  });

  it("group + one solo → solo (rehearsal D1 #3 歩夢)", () => {
    expect(stageTypeForCredit([nijigasaki, ayumu], "full_group")).toBe("solo");
  });

  it("unit + solo → unit", () => {
    expect(stageTypeForCredit([cerise, kaho], "solo")).toBe("unit");
  });

  it("several solos → unchanged", () => {
    expect(stageTypeForCredit([honoka, kotori], "full_group")).toBe("full_group");
    expect(stageTypeForCredit([honoka, kotori], "unit")).toBe("unit");
  });

  it("special is never overridden", () => {
    expect(stageTypeForCredit([aqours], "special")).toBe("special");
    expect(stageTypeForCredit([cerise], "special")).toBe("special");
  });

  it("empty credit or untyped chip → unchanged", () => {
    expect(stageTypeForCredit([], "solo")).toBe("solo");
    const untyped: { id: number; type?: string } = { id: 9 };
    expect(stageTypeForCredit([untyped], "unit")).toBe("unit");
  });

  it("removing the solo chip from 虹ヶ咲 + 歩夢 → back to full_group", () => {
    expect(stageTypeForCredit([nijigasaki], "solo")).toBe("full_group");
  });
});
