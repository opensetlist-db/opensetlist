import { describe, it, expect, beforeAll } from "vitest";
import { formatDate } from "@/lib/utils";
import { formatVenueDate } from "@/lib/eventDateTime";

// Positive control for the TZ pin in vitest.config.ts. The suite runs in
// America/Los_Angeles so a stored UTC date formatted in the process's
// local zone shows up as the previous day. If the pin ever stops taking
// effect (a config change, a pool that ignores it), the "control" case
// below fails and every UTC-safety test in the suite stops meaning
// anything — so it is asserted explicitly rather than assumed.
const STORED_UTC_MIDNIGHT = new Date("2023-03-29T00:00:00.000Z");

// No timeZone option → local zone → March 28 in Los Angeles. Every case
// below only means something when this holds. The zone-less options are
// the point of this control, so local/date-format-timezone is off here.
const localDay = () =>
  // eslint-disable-next-line local/date-format-timezone -- reads the local zone on purpose
  STORED_UTC_MIDNIGHT.toLocaleDateString("en-US", { day: "numeric" });

describe("unit suite timezone pin", () => {
  // Also guard the precondition here so a filtered run (`-t`, `.only`)
  // that skips the control case cannot pass the UTC cases vacuously.
  beforeAll(() => {
    expect(localDay()).toBe("28");
  });

  it("control: a stored UTC midnight reads as the previous local day", () => {
    expect(localDay()).toBe("28");
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
