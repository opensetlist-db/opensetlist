import type { ResolvedEventStatus } from "@/lib/eventStatus";
import { venueIsoString } from "@/lib/venueTime";
import { absoluteUrl, entityPath } from "@/lib/seo/entityUrl";

/**
 * Cap on `performer` entries. A festival lineup is a handful of groups
 * (the 15th Fes is six), so this only guards against a malformed
 * roster dumping dozens of entries into every page's HTML.
 */
export const JSON_LD_PERFORMER_CAP = 20;

export interface EventJsonLdInput {
  /** Localized display name (series short + event full, as in <title>). */
  name: string;
  startTime: Date | string | null;
  /** ISO 3166 code — picks the venue offset for `startDate`. */
  country: string | null;
  status: ResolvedEventStatus;
  venue: string | null;
  /** City only (no country suffix) — goes into `addressLocality`. */
  city: string | null;
  performers: Array<{ id: string | number; slug: string; name: string }>;
  organizerName: string | null;
  /** Absolute canonical URL of this page. */
  canonicalUrl: string;
  locale: string;
}

/**
 * schema.org `MusicEvent` for an event page.
 *
 * Its job is the machine-readable "this is a scheduled event" signal
 * that keeps a not-yet-performed event page from reading as an empty
 * (Soft 404) resource; the visible lineup + schedule copy carry the
 * human side of the same message.
 *
 * Field rules:
 *   - `eventStatus`: `EventScheduled` for upcoming/ongoing,
 *     `EventCancelled` for cancelled, omitted for completed —
 *     schema.org has no "completed" value, and `EventScheduled` is
 *     the documented default when the property is absent.
 *   - `eventAttendanceMode`: always Offline — streaming (配信) isn't
 *     modelled yet; a per-event flag can switch it to Mixed later.
 *   - `location`: Google requires one; with neither venue nor city we
 *     omit it rather than invent a place (the item is then simply
 *     ineligible for the rich result, which is still better than wrong).
 *   - `performer`: the lineup's top-level groups, else the series
 *     artist; each with its absolute artist URL.
 */
export function buildEventJsonLd(
  input: EventJsonLdInput,
): Record<string, unknown> {
  const startDate = venueIsoString(input.startTime, input.country);
  const eventStatus =
    input.status === "cancelled"
      ? "https://schema.org/EventCancelled"
      : input.status === "completed"
        ? null
        : "https://schema.org/EventScheduled";
  const locationName = input.venue || input.city;
  const location = locationName
    ? {
        "@type": "Place",
        name: locationName,
        address: {
          "@type": "PostalAddress",
          ...(input.city ? { addressLocality: input.city } : {}),
          ...(input.country ? { addressCountry: input.country } : {}),
        },
      }
    : null;
  const performer = input.performers
    .slice(0, JSON_LD_PERFORMER_CAP)
    .map((p) => ({
      "@type": "MusicGroup",
      name: p.name,
      url: absoluteUrl(entityPath("artists", input.locale, p.id, p.slug)),
    }));

  return {
    "@context": "https://schema.org",
    "@type": "MusicEvent",
    name: input.name,
    ...(startDate ? { startDate } : {}),
    ...(eventStatus ? { eventStatus } : {}),
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    ...(location ? { location } : {}),
    ...(performer.length > 0 ? { performer } : {}),
    ...(input.organizerName
      ? { organizer: { "@type": "Organization", name: input.organizerName } }
      : {}),
    url: input.canonicalUrl,
    inLanguage: input.locale,
  };
}

/**
 * Serialize for an inline `<script type="application/ld+json">`.
 * Escapes `<` so a name containing `</script>` can't close the tag
 * early (JSON.stringify alone doesn't); `<` is still valid JSON.
 */
export function serializeJsonLd(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
