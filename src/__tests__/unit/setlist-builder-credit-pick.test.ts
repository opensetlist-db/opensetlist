import { describe, it, expect } from "vitest";
import { stageTypeForCredit } from "@/app/admin/events/setlistBuilderRules";

const aqours = { id: 2, type: "group" };
const cerise = { id: 4, type: "unit" };
const kaho = { id: 6, type: "solo" };

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
