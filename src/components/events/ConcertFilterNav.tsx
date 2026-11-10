import Link from "next/link";
import { eventListQuery, FILTER_VALUES, type EventListFilter } from "@/lib/eventFilters";
import { colors } from "@/styles/tokens";

/*
 * Status and artist family filter chips for the concert list.
 *
 * Plain links, not buttons that `router.push`: each filter is its own
 * URL, so back/forward, open-in-new-tab and no-JS all work natively and
 * the current one is announced through `aria-current="page"`. A filter
 * change drops `pastPage` (the past-group page set differs per filter).
 * The locale switcher already carries the query string across locales.
 */

interface Props {
  locale: string;
  active: EventListFilter;
  labels: Record<EventListFilter, string>;
  /** Accessible name of the chip group. */
  label: string;
  artist: string | null;
  artistOptions: { id: string; name: string }[];
  artistLabel: string;
  allArtistsLabel: string;
}

export function ConcertFilterNav({
  locale, active, labels, label, artist, artistOptions, artistLabel, allArtistsLabel,
}: Props) {
  function pill(key: string, filter: EventListFilter, group: string | null, current: boolean, name: string) {
    const query = new URLSearchParams(eventListQuery(filter, group)).toString();
    return (
      <Link
        key={key}
        href={`/${locale}/events${query ? `?${query}` : ""}`}
        aria-current={current ? "page" : undefined}
        className="flex min-h-11 max-w-full items-center justify-center rounded-full border px-3.5 py-2 text-[13px] font-bold [overflow-wrap:anywhere] transition-shadow hover:shadow-[0_2px_8px_#233c681c] min-[700px]:px-[22px] min-[700px]:text-[14px]"
        style={{
          borderColor: current ? colors.primary : colors.borderStrong,
          background: current ? colors.primary : colors.bgCard,
          color: current ? colors.bgCard : colors.textPrimary,
        }}
      >
        {name}
      </Link>
    );
  }

  const navClass = "flex flex-wrap gap-1.5 min-[700px]:gap-2";
  return (
    <div className="mb-6 mt-[22px] space-y-2 min-[700px]:mb-[30px] min-[700px]:mt-[26px]">
      <nav aria-label={label} data-testid="event-status-filter" className={navClass}>
        {FILTER_VALUES.map((value) => pill(value, value, artist, value === active, labels[value]))}
      </nav>
      {artistOptions.length > 0 && (
        <nav aria-label={artistLabel} data-testid="event-artist-filter" className={navClass}>
          {pill("all", active, null, artist === null, allArtistsLabel)}
          {artistOptions.map(({ id, name }) => pill(id, active, id, id === artist, name))}
        </nav>
      )}
    </div>
  );
}
