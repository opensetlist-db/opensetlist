"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { PrimaryButton } from "@/components/ui/Button";
import { displayOriginalTitle } from "@/lib/display";
import { colors } from "@/styles/tokens";
import type {
  AvailableSong,
  UnitFilter,
  UnitFilterKind,
} from "@/lib/types/predict";

interface Props {
  songs: AvailableSong[];
  selectedIds: number[];
  unitFilters: UnitFilter[];
  onToggle: (songId: number) => void;
  locale: string;
  /** Mobile-only confirm bar. Omit on desktop (always-visible panel
   *  has no concept of "done"). */
  onClose?: () => void;
  /** Focus the search input on mount. Mobile sheet sets this `true`
   *  (sheet open is the user's "I want to search" signal). Desktop
   *  side panel passes `false` — auto-focusing on every page load
   *  would steal keyboard flow + announce the placeholder before
   *  the page's primary content. Default `false` so omission on
   *  the desktop mount is safe. */
  autoFocus?: boolean;
}

/**
 * Shared picker shell — search + unit filter chips + scrollable
 * multi-select song list. Mounted both as the body of the mobile
 * `<SongPickerSheet>` (`vaul` Drawer) and as the right-side panel
 * inside `<PredictedSetlist>`'s desktop 2-col layout.
 *
 * The picker is the only entry point for adding to the Predicted
 * Setlist as of v0.13.14+ — the inline `<SongSearch>` autocomplete
 * was removed when this shipped. Wishlist (`<EventWishSection>`)
 * keeps its own SongSearch out of scope.
 *
 * Mockup of record: see `task-song-picker-predict-mode.md` and the
 * mobile + desktop mockup files referenced there.
 *
 * Filter routing is data-driven via `UnitFilter.kind` + `artistId`,
 * NOT hardcoded slugs — `deriveUnitFilters` (server-side) emits the
 * chip set per event's primary artist, so adding a new artist to
 * the catalog requires no client-side changes.
 *
 * Section headers are sticky and only rendered under composite
 * filters (`all` / `sub`) where multiple units are mixed in one
 * list. Under a single-unit filter the header would be redundant.
 */
export function SongPickerContent({
  songs,
  selectedIds,
  unitFilters,
  onToggle,
  locale,
  onClose,
  autoFocus = false,
}: Props) {
  const t = useTranslations("Predict");
  const [query, setQuery] = useState("");
  const [activeFilterKey, setActiveFilterKey] = useState<string>(() => {
    return unitFilters[0]?.key ?? "all";
  });

  const activeFilter: UnitFilter | undefined = unitFilters.find(
    (f) => f.key === activeFilterKey,
  );

  // Set of artistIds covered by a `group` or `individual` chip in
  // this filter set. Used by the `others` routing predicate so the
  // composite catch-all only shows songs whose unit lacks its own
  // chip. Built once per render via `useMemo`.
  const coveredArtistIds = useMemo(() => {
    const ids = new Set<number>();
    for (const f of unitFilters) {
      if (f.artistId !== null && (f.kind === "group" || f.kind === "individual")) {
        ids.add(f.artistId);
      }
    }
    return ids;
  }, [unitFilters]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return songs.filter((song) => {
      // Unit kind routing — data-driven via the filter's kind +
      // artistId. The `all` case skips the predicate entirely.
      if (activeFilter) {
        const kind: UnitFilterKind = activeFilter.kind;
        if (kind === "group" || kind === "individual") {
          // Multi-artist collab songs never appear under a single
          // artist's chip — they're routed to `others` only.
          // `unit.artistId` still points at the fallback solo for
          // display purposes, but routing should ignore it.
          if (song.isMultiArtist) return false;
          if (song.unit.artistId !== activeFilter.artistId) return false;
        } else if (kind === "others") {
          // Catch-all: includes (a) multi-artist collabs unconditionally,
          // and (b) songs whose unit lacks an individual / group chip.
          if (song.isMultiArtist) return true;
          if (coveredArtistIds.has(song.unit.artistId)) return false;
        }
      }
      if (!q) return true;
      if (song.originalTitle.toLowerCase().includes(q)) return true;
      // Search across every translation locale — a Korean fan
      // typing the Latin reading should still find the JP-original
      // song.
      for (const tr of song.translations) {
        if (tr.title.toLowerCase().includes(q)) return true;
      }
      if (song.unit.label.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [songs, query, activeFilter, coveredArtistIds]);

  // Section headers appear under composite filters (`all` + `others`)
  // where the song list mixes multiple units. Under `group` /
  // `individual` the section header would be redundant — every row
  // belongs to the same unit.
  const showSectionHeaders =
    activeFilter?.kind === "all" || activeFilter?.kind === "others";

  // Group the filtered list by unit when section headers are
  // active. Maps preserve insertion order; we walk filtered (which
  // is itself originalTitle-asc from the server) so songs land
  // under their first-seen unit. Sub-unit chips are slug-asc; the
  // group unit (if any) lands first by virtue of appearing in the
  // server's order before any sub-unit song.
  const grouped = useMemo(() => {
    if (!showSectionHeaders) {
      return [{ unitKey: null as string | null, label: "", color: "", songs: filtered }];
    }
    const buckets = new Map<
      number,
      { unitKey: string; label: string; color: string; songs: AvailableSong[] }
    >();
    for (const song of filtered) {
      const existing = buckets.get(song.unit.artistId);
      if (existing) {
        existing.songs.push(song);
      } else {
        buckets.set(song.unit.artistId, {
          unitKey: song.unit.slug,
          label: song.unit.label,
          color: song.unit.color,
          songs: [song],
        });
      }
    }
    return [...buckets.values()].map((b) => ({
      unitKey: b.unitKey,
      label: b.label,
      color: b.color,
      songs: b.songs,
    }));
  }, [filtered, showSectionHeaders]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  // Empty catalog: hide search + filters entirely; surface a single
  // hint line so the user knows the picker mounted but has nothing
  // to show. Distinct from the "filtered result empty" branch
  // below, which keeps the search/filter controls visible.
  if (songs.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm px-4 text-center" style={{ color: colors.textMuted }}>
        {t("picker.emptyCatalog")}
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Search input + filter row — flex-shrink:0 so the
          scrollable song list below takes the remaining height. */}
      <div
        style={{
          padding: "10px 16px 8px",
          borderBottom: `1px solid ${colors.borderLight}`,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: colors.bgSubtle,
            borderRadius: 8,
            border: `1.5px solid ${colors.border}`,
            padding: "7px 10px",
            marginBottom: 8,
          }}
        >
          <span style={{ fontSize: 13, color: colors.textMuted }} aria-hidden>
            🔍
          </span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("picker.searchPlaceholder")}
            aria-label={t("picker.searchPlaceholder")}
            // Mobile sheet opt-in only. Desktop panel passes
            // `false` (default) — the picker is always visible,
            // so unconditional autofocus would steal keyboard
            // flow on every page load and announce the
            // placeholder before any other content.
            autoFocus={autoFocus}
            style={{
              flex: 1,
              border: "none",
              background: "transparent",
              // 16px is iOS Safari's auto-zoom threshold —
              // anything smaller triggers a viewport zoom on
              // focus, which visually widens the whole layout
              // (the bug operator reported as "검색창에 포커스 주면
              // 가로폭이 다시 커져"). Keeping at 16px disables the
              // zoom. Other typography in the picker stays at
              // 11-13px since they're non-interactive.
              fontSize: 16,
              color: colors.textPrimary,
              outline: "none",
              fontFamily: "inherit",
              minWidth: 0,
            }}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label={t("picker.searchClearAria")}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: colors.textMuted,
                fontSize: 14,
                padding: 0,
                lineHeight: 1,
              }}
            >
              ×
            </button>
          )}
        </div>
        {/* Filter chips — horizontal scroll on narrow viewports,
            wrap on desktop where there's more headroom. */}
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {unitFilters.map((f) => {
            const active = f.key === activeFilterKey;
            const accent = f.color ?? colors.primary;
            const style: CSSProperties = {
              padding: "3px 10px",
              borderRadius: 20,
              fontSize: 11,
              fontWeight: 600,
              border: active
                ? `1.5px solid ${accent}`
                : `1.5px solid ${colors.border}`,
              background: active ? `${accent}15` : "white",
              color: active ? accent : colors.textSecondary,
              cursor: "pointer",
              flexShrink: 0,
              fontFamily: "inherit",
              whiteSpace: "nowrap",
            };
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setActiveFilterKey(f.key)}
                // aria-pressed surfaces the active-filter state to
                // screen readers. The visual cue (border + 12%-alpha
                // bg tint) is invisible to assistive tech otherwise.
                aria-pressed={active}
                style={style}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Result count line */}
      <div
        style={{
          padding: "6px 16px",
          fontSize: 10,
          color: colors.textMuted,
          flexShrink: 0,
          borderBottom: `1px solid ${colors.bgSubtle}`,
        }}
      >
        {t("picker.resultCount", {
          count: filtered.length,
          selected: selectedSet.size,
        })}
      </div>

      {/* Song list */}
      <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
        {filtered.length === 0 ? (
          <div
            style={{
              padding: "24px 16px",
              textAlign: "center",
              color: colors.textMuted,
              fontSize: 13,
            }}
          >
            {t("picker.noResults")}
          </div>
        ) : (
          grouped.map((bucket) => (
            <div key={bucket.unitKey ?? "single"}>
              {showSectionHeaders && bucket.unitKey && (
                <div
                  style={{
                    position: "sticky",
                    top: 0,
                    zIndex: 1,
                    padding: "6px 16px",
                    background: colors.bgSubtle,
                    borderBottom: `1px solid ${colors.borderLight}`,
                    fontSize: 11,
                    fontWeight: 700,
                    color: bucket.color,
                    letterSpacing: "0.04em",
                  }}
                >
                  {bucket.label}
                </div>
              )}
              {bucket.songs.map((song) => (
                <SongRow
                  key={song.songId}
                  song={song}
                  selected={selectedSet.has(song.songId)}
                  onToggle={onToggle}
                  locale={locale}
                  showInlineBadge={Boolean(showSectionHeaders)}
                />
              ))}
            </div>
          ))
        )}
      </div>

      {/* Mobile confirm bar — desktop panel omits onClose. */}
      {onClose && (
        <div
          style={{
            padding: "10px 16px",
            borderTop: `1px solid ${colors.borderLight}`,
            background: "white",
            flexShrink: 0,
          }}
        >
          <PrimaryButton onClick={onClose} fullWidth>
            {t("picker.confirmButton", { count: selectedSet.size })}
          </PrimaryButton>
        </div>
      )}
    </div>
  );
}

interface SongRowProps {
  song: AvailableSong;
  selected: boolean;
  onToggle: (songId: number) => void;
  locale: string;
  showInlineBadge: boolean;
}

function SongRow({
  song,
  selected,
  onToggle,
  locale,
  showInlineBadge,
}: SongRowProps) {
  const title = displayOriginalTitle(
    {
      originalTitle: song.originalTitle,
      originalLanguage: song.originalLanguage,
      variantLabel: song.variantLabel,
    },
    song.translations,
    locale,
  );
  return (
    <div
      role="button"
      tabIndex={0}
      // aria-pressed surfaces the row's selection state to screen
      // readers. Without it the checkbox / row-bg-tint cues are
      // invisible to assistive tech.
      aria-pressed={selected}
      onClick={() => onToggle(song.songId)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle(song.songId);
        }
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 16px",
        borderBottom: `1px solid ${colors.bgSubtle}`,
        cursor: "pointer",
        background: selected ? colors.primaryHoverBg : "transparent",
        transition: "background 0.08s",
      }}
    >
      {/* Checkbox — 18×18, blue when selected. Decorative (the row
          itself is the interactive element) but kept rendered for
          the mockup's visual contract. */}
      <div
        aria-hidden
        style={{
          width: 18,
          height: 18,
          borderRadius: 5,
          flexShrink: 0,
          border: selected ? "none" : `1.5px solid ${colors.border}`,
          background: selected ? colors.primary : "white",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {selected && (
          <span
            style={{ color: "white", fontSize: 11, fontWeight: 700, lineHeight: 1 }}
          >
            ✓
          </span>
        )}
      </div>

      {/* Title block — main + sub + optional inline unit badge. */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 6,
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: selected ? colors.primary : colors.textPrimary,
            }}
          >
            {title.main}
          </span>
          {title.sub && (
            <span style={{ fontSize: 11, color: colors.textMuted }}>
              {title.sub}
            </span>
          )}
          {title.variant && (
            <span style={{ fontSize: 10, color: colors.textMuted }}>
              ({title.variant})
            </span>
          )}
          {showInlineBadge && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: song.unit.color,
                background: `${song.unit.color}15`,
                borderRadius: 8,
                padding: "1px 6px",
                whiteSpace: "nowrap",
              }}
            >
              {song.unit.label}
            </span>
          )}
        </div>
      </div>

      <span
        aria-hidden
        style={{
          fontSize: 14,
          color: selected ? colors.primary : colors.textMuted,
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        {selected ? "−" : "+"}
      </span>
    </div>
  );
}
