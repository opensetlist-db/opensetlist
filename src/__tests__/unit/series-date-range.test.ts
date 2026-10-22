import { describe, it, expect } from "vitest";
import { formatSeriesDateRange } from "@/components/series/detail/seriesDate";
import { formatDateRange } from "@/lib/dateRange";

// Series city-group range (32-v1): en dash, UTC day collapse. The shared
// helper keeps "~" for every other page.
describe("formatSeriesDateRange", () => {
  it("joins two days with an en dash", () => {
    expect(
      formatSeriesDateRange("2026-05-01T08:00:00Z", "2026-05-02T08:00:00Z", "ko"),
    ).toBe("2026년 5월 1일 – 2026년 5월 2일");
    expect(
      formatSeriesDateRange("2026-11-14T05:00:00Z", "2026-11-15T05:00:00Z", "en"),
    ).toBe("Nov 14, 2026 – Nov 15, 2026");
  });

  it("collapses two instants on the same UTC day", () => {
    // Positive control: a day apart, the dash appears.
    expect(formatSeriesDateRange("2026-05-24T00:30:00Z", "2026-05-25T00:30:00Z", "ja")).toContain("–");
    expect(formatSeriesDateRange("2026-05-24T00:30:00Z", "2026-05-24T23:30:00Z", "ja")).toBe(
      "2026年5月24日",
    );
  });

  it("leaves the shared helper's separator alone", () => {
    expect(formatDateRange("2026-05-01T08:00:00Z", "2026-05-02T08:00:00Z", "ko")).toContain(" ~ ");
  });
});
