"use client";

import { useId, useState, useEffect, useRef, useCallback } from "react";
import {
  displayOriginalTitle,
  displayNameWithFallback,
} from "@/lib/display";

// UI strings the component renders. Decoupled from next-intl so
// SongSearch works in admin contexts (`src/app/admin/**`) where the
// layout intentionally omits NextIntlClientProvider per CLAUDE.md's
// admin-i18n exemption. Fan callers should compose this from
// `useTranslations("SongSearch")`; admin callers pass Korean literals.
export interface SongSearchTexts {
  placeholder: string;
  loading: string;
  noResults: string;
}

// Shape returned by GET /api/songs/search. Mirrors the route's `select`
// projection. Exported so callers can type their `onSelect` handlers and
// (later) the wishlist/prediction localStorage payloads against the same
// source of truth.
//
// `id` and `baseVersionId` are typed `number`, NOT `string`: the route
// pipes Prisma BigInt fields through `serializeBigInt` (src/lib/utils.ts:30),
// which uses `Number(value)` for the bigint→JSON coercion. The rest of
// the admin UI (SongOption.id, formSongIds: number[]) already assumes
// number; keeping `number` here means `excludeSongIds.includes(r.id)`
// and SetlistBuilder's duplicate guard work correctly with strict
// equality. If serializeBigInt is ever changed to emit strings, every
// admin caller flips at the same time and this type follows.
export interface SongSearchResult {
  id: number;
  originalTitle: string;
  originalLanguage: string;
  variantLabel: string | null;
  baseVersionId: number | null;
  translations: {
    locale: string;
    title: string;
    variantLabel: string | null;
  }[];
  artists: {
    artist: {
      id: number;
      originalName: string;
      originalShortName: string | null;
      originalLanguage: string;
      translations: {
        locale: string;
        name: string;
        shortName: string | null;
      }[];
    };
  }[];
}

interface SongSearchProps {
  onSelect: (song: SongSearchResult) => void;
  // Display locale for title/artist rendering. Wishlist/prediction read
  // it from useLocale(); admin pins to "ko".
  locale: string;
  texts: SongSearchTexts;
  // Hides already-selected songs. Wishlist uses this for its 3-cap;
  // admin uses it so a song picked into the current setlist row doesn't
  // re-appear in the dropdown.
  excludeSongIds?: number[];
  // Default false: variant rows (baseVersionId !== null) are excluded so
  // wishlist + prediction only ever see base versions. Admin opts in via
  // `includeVariants={true}` to retain its current ability to record
  // a setlist row against a specific variant ("Dream Believers (SAKURA Ver.)").
  // The v2 variant 2-stage picker (Week 3) supersedes this for fan UI;
  // admin will likely keep this prop as the "flat list" mode even after
  // v2 ships.
  includeVariants?: boolean;
}

const DEBOUNCE_MS = 300;

export function SongSearch({
  onSelect,
  locale,
  texts,
  excludeSongIds = [],
  includeVariants = false,
}: SongSearchProps) {
  const listboxId = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SongSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks the in-flight fetch so a newer query can abort the older
  // one. Without this, two fetches that race past the debounce window
  // (≥300ms apart, both in flight) can resolve out of order — the
  // older one's setResults clobbers the newer one's data.
  const abortRef = useRef<AbortController | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Cancel any pending debounce + in-flight fetch on unmount so we
  // don't setState after the component is gone (React would warn) and
  // we don't leak a request whose response would race a fresh mount.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  const fetchResults = useCallback(
    async (q: string) => {
      // Abort any prior in-flight fetch. Its catch block sees
      // AbortError and silently exits, leaving loading/results to be
      // managed by this newer call.
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const params = new URLSearchParams({ q });
      if (includeVariants) params.set("includeVariants", "true");
      if (excludeSongIds.length > 0) {
        params.set("excludeIds", excludeSongIds.join(","));
      }
      try {
        const res = await fetch(`/api/songs/search?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Search failed: ${res.status}`);
        const data = (await res.json()) as SongSearchResult[];
        setResults(data);
        setLoading(false);
      } catch (err) {
        // AbortError = a newer fetch superseded us; that fetch owns
        // the next loading/results write, so leave both alone.
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        // Network or parse failure: fall through to empty state rather
        // than leaving stale results in the dropdown. v1 has no retry —
        // user re-types to retry, which matches the existing admin UX.
        setResults([]);
        setLoading(false);
      }
    },
    [includeVariants, excludeSongIds],
  );

  function handleChange(value: string) {
    // Abort any in-flight fetch immediately on every keystroke (not
    // only when the next debounced fetchResults runs 300ms later).
    // Without this, a fetch that resolves DURING the new query's
    // debounce window writes stale setResults + setLoading(false),
    // briefly clobbering the new keystroke's loading=true state.
    if (abortRef.current) abortRef.current.abort();
    if (debounceRef.current) clearTimeout(debounceRef.current);

    setQuery(value);
    setOpen(true);
    if (!value.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(() => {
      fetchResults(value);
    }, DEBOUNCE_MS);
  }

  function handleSelect(song: SongSearchResult) {
    // Cancel any debounce + in-flight fetch before clearing state, so
    // a request scheduled right before the click can't resolve into
    // setResults(stale) after we've already cleared the dropdown.
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (abortRef.current) abortRef.current.abort();
    onSelect(song);
    setQuery("");
    setResults([]);
    setLoading(false);
    setOpen(false);
  }

  // Belt-and-suspenders: the API filters excludeIds, but a stale
  // response from a query mid-flight at the moment of a select could
  // briefly show the just-picked row. Filter again on render.
  const visibleResults = results.filter(
    (r) => !excludeSongIds.includes(r.id),
  );

  const hasQuery = query.trim().length > 0;

  return (
    <div ref={containerRef} className="relative w-full">
      <input
        type="text"
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => setOpen(true)}
        placeholder={texts.placeholder}
        className="w-full px-3 py-2 text-base border border-gray-300 rounded-md focus:outline-none focus:border-gray-500"
        aria-label={texts.placeholder}
        role="combobox"
        aria-expanded={open && hasQuery}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        aria-autocomplete="list"
      />
      {open && hasQuery && (
        <div
          id={listboxId}
          role="listbox"
          className="absolute z-10 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-80 overflow-y-auto"
        >
          {loading && (
            <div className="px-3 py-2 text-sm text-gray-500">
              {texts.loading}
            </div>
          )}
          {!loading && visibleResults.length === 0 && (
            <div className="px-3 py-2 text-sm text-gray-500">
              {texts.noResults}
            </div>
          )}
          {!loading &&
            visibleResults.map((song) => {
              const title = displayOriginalTitle(
                {
                  originalTitle: song.originalTitle,
                  originalLanguage: song.originalLanguage,
                  variantLabel: song.variantLabel,
                },
                song.translations,
                locale,
              );
              const artist = song.artists[0]?.artist;
              const artistName = artist
                ? displayNameWithFallback(
                    {
                      originalName: artist.originalName,
                      originalShortName: artist.originalShortName,
                      originalLanguage: artist.originalLanguage,
                    },
                    artist.translations,
                    locale,
                    "short",
                  )
                : null;
              return (
                <button
                  key={song.id}
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => handleSelect(song)}
                  className="w-full text-left px-3 py-2 hover:bg-gray-50 active:bg-gray-100 border-b border-gray-100 last:border-b-0"
                >
                  <div className="text-sm font-medium text-gray-900">
                    {title.main}
                    {title.variant && (
                      <span className="text-gray-500">
                        {" "}
                        ({title.variant})
                      </span>
                    )}
                  </div>
                  {(title.sub || artistName) && (
                    <div className="text-xs text-gray-500 mt-0.5">
                      {title.sub && <span>{title.sub}</span>}
                      {title.sub && artistName && <span> · </span>}
                      {artistName && <span>{artistName}</span>}
                    </div>
                  )}
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
}
