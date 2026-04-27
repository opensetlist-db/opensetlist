"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  FILTER_VALUES,
  type EventListFilter,
} from "@/lib/eventFilters";
import { colors, radius } from "@/styles/tokens";

interface Props {
  active: EventListFilter;
  /**
   * Pre-resolved labels keyed by filter value. Caller resolves via
   * `getTranslations("Event")` since this is a client component and
   * can't read next-intl from server context.
   */
  labels: Record<EventListFilter, string>;
}

export function FilterBar({ active, labels }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const onSelect = (next: EventListFilter) => {
    if (next === active) return;
    const sp = new URLSearchParams(params.toString());
    if (next === "all") sp.delete("filter");
    else sp.set("filter", next);
    // Filter changes invalidate the past-section page set; reset to
    // page 1 by dropping the param entirely (server-side parsePage
    // defaults to 1).
    sp.delete("pastPage");
    const qs = sp.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  return (
    <div className="mb-4 flex flex-wrap gap-1.5 lg:mb-5">
      {FILTER_VALUES.map((value) => {
        const isActive = value === active;
        return (
          <button
            key={value}
            type="button"
            onClick={() => onSelect(value)}
            aria-pressed={isActive}
            className="text-[12px] font-semibold transition-colors lg:text-[13px]"
            style={{
              padding: "5px 12px",
              borderRadius: radius.badge,
              border: `1.5px solid ${
                isActive ? colors.primary : colors.border
              }`,
              background: isActive ? colors.primaryBg : colors.bgCard,
              color: isActive ? colors.primary : colors.textSecondary,
              fontFamily: "inherit",
            }}
          >
            {labels[value]}
          </button>
        );
      })}
    </div>
  );
}
