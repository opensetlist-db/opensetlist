import { describe, it, expect } from "vitest";
import {
  buildEventJsonLd,
  JSON_LD_PERFORMER_CAP,
  serializeJsonLd,
  type EventJsonLdInput,
} from "@/lib/seo/eventJsonLd";
import { BASE_URL } from "@/lib/config";

const base: EventJsonLdInput = {
  name: "ラブライブ！シリーズ 15th Fes Day.1",
  startTime: new Date("2026-11-14T07:30:00.000Z"),
  country: "JP",
  status: "upcoming",
  venue: "バンテリンドーム ナゴヤ",
  city: "名古屋",
  performers: [
    { id: 94, slug: "muse", name: "μ's" },
    { id: 78, slug: "aqours", name: "Aqours" },
  ],
  organizerName: "ラブライブ！シリーズ",
  canonicalUrl: `${BASE_URL}/ja/events/107/lovelive-15th-fes-day1`,
  locale: "ja",
};

describe("buildEventJsonLd", () => {
  it("builds a MusicEvent for an upcoming event", () => {
    expect(buildEventJsonLd(base)).toEqual({
      "@context": "https://schema.org",
      "@type": "MusicEvent",
      name: "ラブライブ！シリーズ 15th Fes Day.1",
      startDate: "2026-11-14T16:30:00+09:00",
      eventStatus: "https://schema.org/EventScheduled",
      eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
      location: {
        "@type": "Place",
        name: "バンテリンドーム ナゴヤ",
        address: {
          "@type": "PostalAddress",
          addressLocality: "名古屋",
          addressCountry: "JP",
        },
      },
      performer: [
        { "@type": "MusicGroup", name: "μ's", url: `${BASE_URL}/ja/artists/94/muse` },
        { "@type": "MusicGroup", name: "Aqours", url: `${BASE_URL}/ja/artists/78/aqours` },
      ],
      organizer: { "@type": "Organization", name: "ラブライブ！シリーズ" },
      url: `${BASE_URL}/ja/events/107/lovelive-15th-fes-day1`,
      inLanguage: "ja",
    });
  });

  it("omits eventStatus for completed events (no schema.org value)", () => {
    const ld = buildEventJsonLd({ ...base, status: "completed" });
    expect(ld).not.toHaveProperty("eventStatus");
    expect(ld.startDate).toBe("2026-11-14T16:30:00+09:00");
  });

  it("uses EventCancelled for cancelled events", () => {
    expect(buildEventJsonLd({ ...base, status: "cancelled" }).eventStatus).toBe(
      "https://schema.org/EventCancelled",
    );
  });

  it("omits location/performer/organizer when there is nothing to say", () => {
    const ld = buildEventJsonLd({
      ...base,
      venue: null,
      city: null,
      performers: [],
      organizerName: null,
    });
    expect(ld).not.toHaveProperty("location");
    expect(ld).not.toHaveProperty("performer");
    expect(ld).not.toHaveProperty("organizer");
  });

  it("caps the performer list", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      id: i + 1,
      slug: `a${i}`,
      name: `A${i}`,
    }));
    const ld = buildEventJsonLd({ ...base, performers: many });
    expect(ld.performer).toHaveLength(JSON_LD_PERFORMER_CAP);
  });
});

describe("serializeJsonLd", () => {
  it("escapes < so a name cannot close the script tag", () => {
    const out = serializeJsonLd({ name: "</script><b>x" });
    expect(out).not.toContain("</script>");
    expect(JSON.parse(out).name).toBe("</script><b>x");
  });
});
