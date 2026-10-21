import { describe, it, expect } from "vitest";
import { formatDate } from "@/lib/utils";
import { formatVenueDate } from "@/lib/eventDateTime";

// Positive control for the TZ pin in vitest.config.ts. The suite runs in
// America/Los_Angeles so a stored UTC date formatted in the process's
// local zone shows up as the previous day. If the pin ever stops taking
// effect (a config change, a pool that ignores it), the "control" case
// below fails and every UTC-safety test in the suite stops meaning
// anything — so it is asserted explicitly rather than assumed.
const STORED_UTC_MIDNIGHT = new Date("2023-03-29T00:00:00.000Z");

describe("unit suite timezone pin", () => {
  it("control: the process runs in a UTC-negative zone", () => {
    expect(process.env.TZ).toBe("America/Los_Angeles");
    // No timeZone option → local zone → March 28 in Los Angeles.
    expect(
      STORED_UTC_MIDNIGHT.toLocaleDateString("en-US", { day: "numeric" }),
    ).toBe("28");
  });

  it.each(["ko", "ja", "en"])(
    "formatDate renders the stored UTC day (29) in %s",
    (locale) => {
      const rendered = formatDate(STORED_UTC_MIDNIGHT, locale);
      expect(rendered).toMatch(/29/);
      expect(rendered).not.toMatch(/28/);
    },
  );

  it("formatVenueDate keeps the month name for the 1st of a month", () => {
    // Date.UTC(2023, 2, 1) read in local time is Feb 28 in Los Angeles.
    expect(formatVenueDate("2023-03-01", "en")).toBe("March 1, 2023");
  });
});
