import Link from "next/link";
import type { ReactNode } from "react";
import type { EventDisplayText } from "@/lib/eventDisplay";
import { EventNameText } from "./EventNameText";
import { eventListQuery, FILTER_VALUES, type EventListFilter } from "@/lib/eventFilters";
import { colors } from "@/styles/tokens";

interface Props {
  locale: string;
  active: EventListFilter;
  labels: Record<EventListFilter, string>;
  /** Accessible name of the chip group. */
  label: string;
  artist: string | null;
  artistOptions: { id: string; name: EventDisplayText | null }[];
  artistLabel: string;
  allArtistsLabel: string;
}

/**
 * Links keep both choices in the URL for browser history and locale switches.
 * Each change drops the page number because it can change the past-group count.
 */
export function ConcertFilterNav({
  locale, active, labels, label, artist, artistOptions, artistLabel, allArtistsLabel,
}: Props) {
  function pill(key: string, filter: EventListFilter, group: string | null, current: boolean, name: ReactNode) {
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
          {artistOptions.map(({ id, name }) => pill(id, active, id, id === artist,
            name ? <EventNameText pair={name} /> : id))}
        </nav>
      )}
    </div>
  );
}
