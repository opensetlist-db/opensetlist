"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ActualSetlist } from "@/components/ActualSetlist";
import { PredictedSetlist } from "@/components/PredictedSetlist";
import { SetlistTabs, type SetlistTab } from "@/components/SetlistTabs";
import { useMounted } from "@/hooks/useMounted";
import { hasPredictions as readHasPredictions } from "@/lib/predictionsStorage";
import type {
  LiveSetlistItem,
  ReactionCountsMap,
} from "@/lib/types/setlist";

interface Props {
  eventId: string;
  items: LiveSetlistItem[];
  reactionCounts: ReactionCountsMap;
  locale: string;
}

/**
 * Tab-aware wrapper for the SETLIST surface body. Sits inside
 * `<LiveSetlist>`'s white card, BELOW the existing card header
 * (per task `wiki/output/task-week2-setlistsection-tab-refactor.md`
 * decision table — preserves the SETLIST h2 + LIVE pill + count
 * subtitle in all states; mockup shows tabs replacing the header,
 * but the user picked "tabs sit below" to keep the LIVE pill
 * visible).
 *
 * Visibility per the task's tab matrix:
 *   - !hasPredictions             → only `<ActualSetlist>` (no tab strip)
 *   - hasPredictions, !hasActual  → only `<PredictedSetlist>` (Predicted tab only)
 *   - hasPredictions,  hasActual  → tab strip + body for active tab
 *
 * `hasPredictions` is a client-only signal (localStorage). SSR +
 * first client render see `false`; the mounted-gated re-read may
 * flip to `true` post-hydration. Until Stage C ships the predict
 * writer, this flip never happens in practice — `hasPredictions`
 * stays `false` and the section renders byte-equivalent to the
 * pre-refactor page (the load-bearing constraint).
 */
export function SetlistSection({
  eventId,
  items,
  reactionCounts,
  locale,
}: Props) {
  const t = useTranslations("Setlist");
  const mounted = useMounted();

  // Hydrate `hasPredictions` AFTER mount so SSR + first client
  // render produce matching HTML (false). Mirrors the
  // `<EventWishSection>` mounted-gated read pattern. NOT a
  // useEffect: the `useMounted` hook is the canonical React 18+
  // replacement and avoids `react-hooks/set-state-in-effect`.
  const [hasPredictions, setHasPredictions] = useState(false);
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);
  if (mounted && hydratedKey !== eventId) {
    setHydratedKey(eventId);
    setHasPredictions(readHasPredictions(eventId));
  }

  const hasActual = items.length > 0;
  // Default to actual when both tabs are visible (case 2) — the
  // viewer's mental model in a during/post-show event is "what's
  // actually playing", not "what I predicted earlier". When only
  // the Predicted tab exists (case 1, pre-show), force the active
  // tab to "predicted" so the body matches the visible tab.
  const [activeTab, setActiveTab] = useState<SetlistTab>("actual");
  // Compute the rendered active-tab key separately so a state mismatch
  // (e.g. activeTab="actual" but hasActual=false) renders the right
  // body without forcing the user-driven activeTab state to chase
  // the hasActual prop.
  const renderedTab: SetlistTab =
    hasPredictions && !hasActual ? "predicted" : activeTab;

  return (
    <>
      <SetlistTabs
        hasPredictions={hasPredictions}
        hasActual={hasActual}
        activeTab={renderedTab}
        onTabChange={setActiveTab}
        labels={{
          actual: t("tabActual"),
          predicted: t("tabPredicted"),
        }}
      />
      {renderedTab === "actual" ? (
        <ActualSetlist
          items={items}
          reactionCounts={reactionCounts}
          locale={locale}
          eventId={eventId}
        />
      ) : (
        <PredictedSetlist />
      )}
    </>
  );
}
