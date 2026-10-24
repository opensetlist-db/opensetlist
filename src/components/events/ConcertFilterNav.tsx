import Link from "next/link";
import { FILTER_VALUES, type EventListFilter } from "@/lib/eventFilters";
import { colors } from "@/styles/tokens";

/*
 * Status filter chips for the concert list (16-v1 `#filters`).
 *
 * Plain links, not buttons that `router.push`: each filter is its own
 * URL, so back/forward, open-in-new-tab and no-JS all work natively and
 * the current one is announced through `aria-current="page"`. A filter
 * change drops `pastPage` (the past-group page set differs per filter);
 * "all" drops `filter` too so the default URL stays clean. The locale
 * switcher already carries the query string across locales.
 */

interface Props {
  locale: string;
  active: EventListFilter;
  labels: Record<EventListFilter, string>;
  /** Accessible name of the chip group. */
  label: string;
}

export function ConcertFilterNav({ locale, active, labels, label }: Props) {
  return (
    <nav
      aria-label={label}
      className="mb-6 mt-[22px] flex flex-wrap gap-1.5 min-[700px]:mb-[30px] min-[700px]:mt-[26px] min-[700px]:gap-2"
    >
      {FILTER_VALUES.map((value) => {
        const current = value === active;
        const href =
          value === "all"
            ? `/${locale}/events`
            : `/${locale}/events?filter=${value}`;
        return (
          <Link
            key={value}
            href={href}
            aria-current={current ? "page" : undefined}
            className="flex min-h-11 items-center justify-center rounded-full border px-3.5 py-2 text-[13px] font-bold transition-shadow hover:shadow-[0_2px_8px_#233c681c] min-[700px]:px-[22px] min-[700px]:text-[14px]"
            style={{
              borderColor: current ? colors.primary : colors.borderStrong,
              background: current ? colors.primary : colors.bgCard,
              color: current ? colors.bgCard : colors.textPrimary,
            }}
          >
            {labels[value]}
          </Link>
        );
      })}
    </nav>
  );
}
