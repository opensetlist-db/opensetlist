"use client";

import { useTranslations } from "next-intl";
import { displayNameWithFallback } from "@/lib/display";

export interface PerformerOption {
  stageIdentityId: string;
  originalName: string | null;
  originalShortName: string | null;
  originalLanguage: string;
  translations: { locale: string; name: string; shortName: string | null }[];
  isGuest: boolean;
}

interface Props {
  performers: PerformerOption[];
  checkedIds: Set<string>;
  onToggle: (stageIdentityId: string) => void;
  locale: string;
}

/**
 * Checkbox grid of every performer on the event — both host
 * (`isGuest=false`) and guest (`isGuest=true`) StageIdentities. The
 * parent's auto-fill effect pre-checks the appropriate subset
 * (`unit's current members ∩ event.performers` for unit-type songs,
 * `all event performers` for full_group), then the user manually
 * overrides as needed.
 *
 * Layout: 3-col grid on `≥ sm`, 2-col on mobile — fits 9-ish
 * Hasunosora-sized event rosters comfortably without horizontal
 * scroll. Guests render with a muted "· 게스트" suffix (mirrors
 * `<PerformersCard>`'s convention).
 *
 * Display names use `displayNameWithFallback(..., "full")` — same
 * helper the rest of the surface uses. The "full" variant (vs
 * "short") gives the unabbreviated form so similar-name disambiguation
 * is easier in a tappable list.
 */
export function PerformerChecklist({
  performers,
  checkedIds,
  onToggle,
  locale,
}: Props) {
  // Reuse the existing `Event.guestLabel` key (`<UnitsCard>` /
  // `<PerformersCard>` already render the muted suffix from this).
  // Avoids adding a parallel `AddItem.guestLabel` and ensures the
  // wording stays consistent across the SETLIST surface.
  const eventT = useTranslations("Event");
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {performers.map((p) => {
        const name = displayNameWithFallback(
          {
            originalName: p.originalName ?? "",
            originalShortName: p.originalShortName,
            originalLanguage: p.originalLanguage,
          },
          p.translations,
          locale,
          "full",
        );
        const checked = checkedIds.has(p.stageIdentityId);
        return (
          <label
            key={p.stageIdentityId}
            className={
              checked
                ? "flex items-center gap-2 px-2.5 py-2 rounded-md bg-gray-50 border border-gray-300 cursor-pointer text-sm"
                : "flex items-center gap-2 px-2.5 py-2 rounded-md border border-gray-200 cursor-pointer text-sm hover:bg-gray-50"
            }
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => onToggle(p.stageIdentityId)}
              className="accent-gray-900"
            />
            <span className="text-gray-900">{name}</span>
            {p.isGuest && (
              <span className="text-xs text-gray-400">
                · {eventT("guestLabel")}
              </span>
            )}
          </label>
        );
      })}
    </div>
  );
}
