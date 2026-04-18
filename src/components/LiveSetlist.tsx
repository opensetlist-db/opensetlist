"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { pickTranslation, slugify } from "@/lib/utils";
import { displayOriginalTitle } from "@/lib/display";
import { ReactionButtons } from "@/components/ReactionButtons";
import {
  useSetlistPolling,
  type ReactionCountsMap,
} from "@/hooks/useSetlistPolling";

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
  parentArtistId?: number | null;
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
  note: string | null;
  status: string;
  performanceType: string | null;
  type: string;
  songs: Array<{ song: SongRef }>;
  performers: Array<{
    stageIdentity: { id: number; translations: NameTranslation[] };
    realPerson: { id: number; translations: NameTranslation[] } | null;
  }>;
  artists: Array<{ artist: ArtistRef }>;
};

interface Props {
  eventId: string;
  initialItems: LiveSetlistItem[];
  initialReactionCounts: ReactionCountsMap;
  isOngoing: boolean;
  locale: string;
}

export function LiveSetlist({
  eventId,
  initialItems,
  initialReactionCounts,
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

  const mainItems = items.filter((item) => !item.isEncore);
  const encoreItems = items.filter((item) => item.isEncore);

  return (
    <section className="mb-8">
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
          <SetlistList
            items={mainItems}
            locale={locale}
            t={t}
            reactionCounts={reactionCounts}
          />
          {encoreItems.length > 0 && (
            <>
              <h3 className="mb-2 mt-6 text-lg font-semibold text-zinc-600">
                {ct("encore")}
              </h3>
              <SetlistList
                items={encoreItems}
                locale={locale}
                t={t}
                reactionCounts={reactionCounts}
              />
            </>
          )}
        </>
      )}
    </section>
  );
}

function SetlistList({
  items,
  locale,
  t,
  reactionCounts,
}: {
  items: LiveSetlistItem[];
  locale: string;
  t: ReturnType<typeof useTranslations<"Event">>;
  reactionCounts: ReactionCountsMap;
}) {
  return (
    <ol className="space-y-3">
      {items.map((item, index) => {
        const songNames = item.songs.map((s) => {
          const sTr = pickTranslation(s.song.translations, locale);
          const { main, sub, variant } = displayOriginalTitle(
            s.song,
            sTr ?? null,
            locale,
          );
          return {
            id: s.song.id,
            main,
            sub,
            variantLabel: variant,
            artists: s.song.artists,
          };
        });

        const performers = item.performers.map((p) => {
          const siTr = pickTranslation(p.stageIdentity.translations, locale);
          return siTr?.name ?? t("unknownPerformer");
        });

        const unitArtist =
          item.stageType !== "full_group" && item.artists?.[0]
            ? item.artists[0]
            : null;
        const unitArtistTr = unitArtist
          ? pickTranslation(unitArtist.artist.translations, locale)
          : null;

        return (
          <li key={item.id} className="border-b border-zinc-100 pb-2">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 w-6 shrink-0 text-right text-sm font-mono text-zinc-400">
                {index + 1}
              </span>
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-1">
                  {songNames.length > 0 ? (
                    songNames.map((song, i) => (
                      <span key={song.id}>
                        {i > 0 && (
                          <span className="mx-1 text-zinc-400">+</span>
                        )}
                        <Link
                          href={`/${locale}/songs/${song.id}/${slugify(song.main)}`}
                          className="font-medium text-blue-600 hover:underline"
                        >
                          {song.main}
                        </Link>
                        {song.sub && (
                          <span className="ml-1 text-sm text-zinc-400">
                            {song.sub}
                          </span>
                        )}
                        {song.variantLabel && (
                          <span className="ml-1 text-xs text-zinc-500">
                            ({song.variantLabel})
                          </span>
                        )}
                      </span>
                    ))
                  ) : item.type !== "song" ? (
                    <span className="font-medium text-zinc-500">
                      {t(`itemType.${item.type}` as Parameters<typeof t>[0])}
                    </span>
                  ) : (
                    <span className="text-zinc-400">{t("noSongAssigned")}</span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap gap-2 text-sm text-zinc-500">
                  {item.stageType !== "full_group" &&
                    (unitArtistTr ? (
                      <Link
                        href={`/${locale}/artists/${unitArtist!.artist.id}/${slugify(unitArtistTr.name ?? "")}`}
                        className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs hover:underline"
                      >
                        {unitArtistTr.name}
                      </Link>
                    ) : (
                      <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs">
                        {item.unitName ??
                          t(
                            `stageType.${item.stageType}` as Parameters<
                              typeof t
                            >[0],
                          )}
                      </span>
                    ))}
                  {performers.length > 0 && (
                    <span>{performers.join(", ")}</span>
                  )}
                </div>
                {item.type === "song" && !item.isEncore && item.note && (
                  <p className="mt-1 text-xs text-zinc-400">{item.note}</p>
                )}
                {/*
                  Note: ReactionButtons seeds its counts from initialCounts once
                  on mount and does not re-sync on prop change. Existing items
                  won't reflect other users' count bumps until remount. Fresh
                  counts apply to newly-inserted items. Phase 1C (Supabase
                  Realtime) will address this.
                */}
                <ReactionButtons
                  setlistItemId={String(item.id)}
                  initialCounts={reactionCounts[String(item.id)] ?? {}}
                />
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
