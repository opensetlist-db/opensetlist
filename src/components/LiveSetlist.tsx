"use client";

import { useTranslations } from "next-intl";
import { TrendingSongs, type TrendingSong } from "@/components/TrendingSongs";
import { SetlistRow } from "@/components/SetlistRow";
import {
  useSetlistPolling,
  type ReactionCountsMap,
} from "@/hooks/useSetlistPolling";
import { deriveTrendingSongs } from "@/lib/trending";

type NameTranslation = {
  locale: string;
  name: string;
  shortName?: string | null;
};

type SongTranslation = {
  locale: string;
  title: string;
  variantLabel?: string | null;
};

type ArtistRef = {
  id: number;
  slug: string;
  parentArtistId?: number | null;
  color: string | null;
  originalName: string | null;
  originalShortName: string | null;
  originalLanguage: string;
  translations: NameTranslation[];
};

type StageIdentityRef = {
  id: string;
  originalName: string | null;
  originalShortName: string | null;
  originalLanguage: string;
  translations: NameTranslation[];
};

type RealPersonRef = {
  id: string;
  originalName: string | null;
  originalStageName: string | null;
  originalLanguage: string;
  translations: NameTranslation[];
};

type SongRef = {
  id: number;
  originalTitle: string;
  originalLanguage: string;
  variantLabel: string | null;
  translations: SongTranslation[];
  artists: Array<{ artist: ArtistRef }>;
};

export type LiveSetlistItem = {
  id: number;
  position: number;
  isEncore: boolean;
  stageType: string;
  unitName: string | null;
  status: string;
  performanceType: string | null;
  type: string;
  songs: Array<{ song: SongRef }>;
  performers: Array<{
    stageIdentity: StageIdentityRef;
    realPerson: RealPersonRef | null;
  }>;
  artists: Array<{ artist: ArtistRef }>;
};

interface Props {
  eventId: string;
  initialItems: LiveSetlistItem[];
  initialReactionCounts: ReactionCountsMap;
  initialTrendingSongs: TrendingSong[];
  unknownSongLabel: string;
  isOngoing: boolean;
  locale: string;
}

export function LiveSetlist({
  eventId,
  initialItems,
  initialReactionCounts,
  initialTrendingSongs,
  unknownSongLabel,
  isOngoing,
  locale,
}: Props) {
  const t = useTranslations("Event");
  const ct = useTranslations("Common");

  const { items, reactionCounts } = useSetlistPolling<LiveSetlistItem>({
    eventId,
    initialItems,
    initialReactionCounts,
    enabled: isOngoing,
  });

  // While polling, derive trending from the same reactionCounts that drives
  // per-item counts — single source of truth, no risk of the two views
  // drifting. When polling is off (upcoming/completed events) we keep the
  // SSR seed; no recompute, no behavior change.
  const trendingSongs = isOngoing
    ? deriveTrendingSongs(items, reactionCounts, locale, unknownSongLabel)
    : initialTrendingSongs;

  const mainItems = items.filter((item) => !item.isEncore);
  const encoreItems = items.filter((item) => item.isEncore);

  return (
    <section className="mb-8">
      <TrendingSongs songs={trendingSongs} />
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-xl font-semibold">{t("setlist")}</h2>
        {isOngoing && (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
            {t("live")}
          </span>
        )}
      </div>
      {items.length === 0 ? (
        <p className="text-zinc-500">{t("noSetlist")}</p>
      ) : (
        <>
          <ol className="space-y-3 lg:space-y-0">
            {mainItems.map((item, index) => (
              <SetlistRow
                key={item.id}
                item={item}
                index={index}
                reactionCounts={reactionCounts}
                locale={locale}
                eventId={eventId}
              />
            ))}
          </ol>
          {encoreItems.length > 0 && (
            <>
              <EncoreDivider label={ct("encore")} />
              <ol className="space-y-3 lg:space-y-0">
                {encoreItems.map((item, index) => (
                  <SetlistRow
                    key={item.id}
                    item={item}
                    index={index}
                    reactionCounts={reactionCounts}
                    locale={locale}
                    eventId={eventId}
                  />
                ))}
              </ol>
            </>
          )}
        </>
      )}
    </section>
  );
}

// Encore divider — Common.encore key with CSS uppercase + tracking. No new
// i18n key needed (handoff §6 visual uses ALL-CAPS but the underlying label
// text stays locale-driven).
function EncoreDivider({ label }: { label: string }) {
  return (
    <div className="my-4 flex items-center gap-3">
      <div className="h-px flex-1 bg-zinc-200" />
      <span className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
        {label}
      </span>
      <div className="h-px flex-1 bg-zinc-200" />
    </div>
  );
}
