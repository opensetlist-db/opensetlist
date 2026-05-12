"use client";

import {
  useId,
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
} from "react";
import { createPortal } from "react-dom";
import {
  displayOriginalTitle,
  displayNameWithFallback,
} from "@/lib/display";
import { useMounted } from "@/hooks/useMounted";
import { colors, zIndex } from "@/styles/tokens";

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
  // "default": admin-style — full-width input, base 16px text, gray
  // border, rounded-md. The shape every existing caller has been using.
  // "compact": wishlist-inline style — pill input (rounded-20px), 12px
  // text, blue 0.5px border, denser dropdown rows. Keyboard nav, ARIA,
  // debounce, abort, and result rendering are byte-identical between
  // variants — `variant` only swaps the cosmetic className strings.
  // Mockup source: raw/mockups/mockup-wish-predict.jsx `InlineSongSearch`.
  variant?: "default" | "compact";
  // Mount-time focus. Independent of `variant` so an admin caller can
  // opt-in to autofocus without the compact look. The wishlist's
  // `+ 추가` reveal pairs `variant="compact"` + `autoFocus` so the input
  // is ready for typing the moment it appears.
  autoFocus?: boolean;
}

const DEBOUNCE_MS = 300;

export function SongSearch({
  onSelect,
  locale,
  texts,
  excludeSongIds = [],
  includeVariants = false,
  variant = "default",
  autoFocus = false,
}: SongSearchProps) {
  const isCompact = variant === "compact";
  const listboxId = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SongSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  // -1 = no active descendant (input has focus, no row "highlighted").
  // Set by ArrowDown/ArrowUp; consumed by Enter and aria-activedescendant.
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  // Compact-variant focus tracking. We need this only because the
  // compact input renders its border via inline `style` (so the
  // wishlist token values from `colors` are the single source of
  // truth — Tailwind arbitrary values like `border-[#0277BD]` would
  // duplicate the hex). Inline styles can't express `:focus`, so we
  // track focus in state and toggle the border color from JS.
  // Default variant unaffected — it stays on Tailwind classes that
  // do support `focus:` natively.
  const [inputFocused, setInputFocused] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks the in-flight fetch so a newer query can abort the older
  // one. Without this, two fetches that race past the debounce window
  // (≥300ms apart, both in flight) can resolve out of order — the
  // older one's setResults clobbers the newer one's data.
  const abortRef = useRef<AbortController | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Portal target ref — separate from the input's container because
  // the dropdown gets rendered to `document.body` (escapes ancestor
  // `overflow: hidden` like the wishlist card and the live-setlist
  // section). Click-outside detection has to consult both refs so a
  // mousedown on a dropdown row doesn't fire the close-handler
  // before the option's onClick can land. v0.10.0 smoke caught the
  // clipping: the dropdown only displayed its first row on the
  // wishlist + predicted-setlist surfaces because the absolute-
  // positioned listbox got clipped to the parent card's rounded
  // bounds; arrow-key nav still moved through the items but they
  // were visually hidden.
  const dropdownRef = useRef<HTMLDivElement>(null);
  // SSR-safe portal-target gate: `useMounted` returns false during
  // SSR + first client commit, true thereafter. Project canonical
  // pattern (see `src/hooks/useMounted.ts:9-18`) — equivalent to a
  // `useState(false) + useEffect(() => setMounted(true))` pair but
  // doesn't trip `react-hooks/set-state-in-effect`. The dropdown
  // gate `open && hasQuery` already starts false (only flips on
  // user input, which is post-mount anyway), so first paint is
  // unaffected.
  const mounted = useMounted();
  // Computed fixed-position coords for the portalled dropdown.
  // Recomputed on open + window scroll/resize so the dropdown
  // tracks the input even if the page scrolls behind the dropdown.
  // Closing on scroll would be simpler but harms mobile UX (virtual
  // keyboard appearance triggers a scroll; we don't want the
  // dropdown to vanish out from under the user every keystroke).
  const [dropdownPos, setDropdownPos] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      const insideContainer = containerRef.current?.contains(target);
      const insideDropdown = dropdownRef.current?.contains(target);
      if (!insideContainer && !insideDropdown) {
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
    // New query → previous active row is meaningless. Reset so the
    // user has to press Down to start navigating the new result set.
    setActiveIndex(-1);
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
    setActiveIndex(-1);
  }

  // Belt-and-suspenders: the API filters excludeIds, but a stale
  // response from a query mid-flight at the moment of a select could
  // briefly show the just-picked row. Filter again on render.
  const visibleResults = results.filter(
    (r) => !excludeSongIds.includes(r.id),
  );

  const hasQuery = query.trim().length > 0;
  const optionId = (songId: number) => `${listboxId}-option-${songId}`;
  // aria-activedescendant must point only at a DOM element that
  // actually exists. The listbox renders iff `open && hasQuery`, so
  // gate the descendant id on the same condition — otherwise a
  // click-outside (which closes via setOpen(false) but leaves
  // activeIndex untouched) would leave aria-activedescendant
  // referencing an id that's no longer in the tree.
  const activeOptionId =
    open &&
    hasQuery &&
    activeIndex >= 0 &&
    activeIndex < visibleResults.length
      ? optionId(visibleResults[activeIndex].id)
      : undefined;

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      // Wrap-around vs clamp: clamp keeps things predictable on small
      // result sets (Down at the bottom doesn't jump back to top).
      setActiveIndex((prev) =>
        Math.min(prev + 1, visibleResults.length - 1),
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      if (activeIndex >= 0 && activeIndex < visibleResults.length) {
        e.preventDefault();
        handleSelect(visibleResults[activeIndex]);
      }
    } else if (e.key === "Escape") {
      // Don't preventDefault unconditionally — if the dropdown is
      // already closed, let Escape bubble (some parent forms wire
      // Esc to cancel/close themselves).
      if (open) {
        e.preventDefault();
        setOpen(false);
        setActiveIndex(-1);
      }
    }
  }

  // Scroll the active option into view when keyboard navigation pushes
  // it past the listbox's max-height. `block: "nearest"` avoids the
  // page-jump that "center" / "start" would cause. Guard for jsdom +
  // any older runtime without scrollIntoView — falling back to no-op
  // is fine (visual nicety, not correctness).
  useEffect(() => {
    if (activeIndex < 0) return;
    const song = visibleResults[activeIndex];
    if (!song) return;
    const el = document.getElementById(optionId(song.id));
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest" });
    }
    // optionId closes over listboxId; depending on activeIndex +
    // visibleResults is enough to fire on every nav step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, visibleResults]);

  // Compute the portalled dropdown's coords from the input's bounding
  // rect, stored in **document-relative** coordinates so the dropdown
  // uses `position: absolute` (not `fixed`). useLayoutEffect (not
  // useEffect) so the position is measured + applied BEFORE the browser
  // paints — prevents a single-frame flash of the dropdown at (0, 0)
  // before the effect catches up. 4px gap below the input matches the
  // previous `mt-1` Tailwind utility used when the dropdown was an
  // absolute child.
  //
  // **iOS Safari soft-keyboard quirk** (fixed in this commit, originally
  // shipped as `position: fixed` in PR #290): when the on-screen
  // keyboard is open, iOS Safari handles `position: fixed` unreliably —
  // fixed elements either fail to track the visual viewport or scroll
  // with the page, depending on the page state. Operator reported the
  // dropdown ending up off-screen with "scroll up to see it" recovery
  // on both wishlist + predict surfaces. Switching to `position:
  // absolute` with `top: rect.bottom + window.scrollY` puts the
  // dropdown in **document space** — it sits at a fixed point in the
  // document and scrolls naturally with the page (and with the input,
  // which is also in document flow). No iOS quirk to fight; the
  // dropdown stays anchored to the input through every keyboard /
  // scroll transition.
  //
  // The scroll + visualViewport listeners still fire `update()` because
  // **layout reflow** (not scroll position) can move the input in
  // document space — e.g. iOS keyboard appearing pushes layout up,
  // dynamic content above the input expanding, orientation change,
  // etc. Without listeners the dropdown would drift on those events.
  // Scrolling itself no longer needs handling (absolute positioning
  // handles it automatically) but the scroll event is a useful coarse
  // signal that "something is moving" — cheap to keep.
  //
  // No early-return-with-setState — the closed-dropdown state is
  // already gated by `open && hasQuery && dropdownPos !== null` at
  // render. A stale `dropdownPos` left from a previous open won't
  // render. Avoiding the early-return setState also keeps the
  // effect lint-clean (`react-hooks/set-state-in-effect` permits
  // the listener-callback setState since it's async, but blocks a
  // synchronous setState in the effect body).
  useLayoutEffect(() => {
    if (!open || !hasQuery) return;
    const input = containerRef.current?.querySelector("input");
    if (!input) return;
    const update = () => {
      const rect = input.getBoundingClientRect();
      // Document-relative coords: viewport rect + current scroll
      // offset. With `position: absolute` on the portalled dropdown,
      // this places it at a fixed point in the document — scrolls
      // with the input naturally, no iOS Safari fixed-positioning
      // quirks.
      setDropdownPos({
        top: rect.bottom + window.scrollY + 4,
        left: rect.left + window.scrollX,
        width: rect.width,
      });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    // iOS Safari: the on-screen keyboard show/hide does NOT consistently
    // fire `window.resize` / `window.scroll` — only `visualViewport`
    // reliably emits during keyboard transitions. Layout reflow during
    // the keyboard animation can shift the input's document position,
    // and update() needs to fire so the dropdown follows.
    const vv = window.visualViewport;
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
    };
  }, [open, hasQuery]);

  const dropdown = open && hasQuery && dropdownPos !== null && (
    <div
      ref={dropdownRef}
      id={listboxId}
      role="listbox"
      className={
        isCompact
          ? "bg-white border rounded-lg shadow-md max-h-60 overflow-y-auto"
          : "bg-white border border-gray-200 rounded-md shadow-lg max-h-80 overflow-y-auto"
      }
      style={{
        // Document-relative absolute positioning (NOT fixed) — see
        // the useLayoutEffect docstring above for the iOS Safari
        // soft-keyboard rationale. `top` / `left` carry doc coords
        // (viewport rect + scroll offset), so the dropdown sits at
        // a fixed point in the document and scrolls naturally with
        // the input.
        position: "absolute",
        top: dropdownPos.top,
        left: dropdownPos.left,
        width: dropdownPos.width,
        zIndex: zIndex.dropdown,
        ...(isCompact ? { borderColor: colors.wishlistBorder } : {}),
      }}
    >
      {loading && (
        <div
          className={
            isCompact
              ? "px-2.5 py-1.5 text-xs text-gray-500"
              : "px-3 py-2 text-sm text-gray-500"
          }
        >
          {texts.loading}
        </div>
      )}
      {!loading && visibleResults.length === 0 && (
        <div
          className={
            isCompact
              ? "px-2.5 py-1.5 text-xs text-gray-500"
              : "px-3 py-2 text-sm text-gray-500"
          }
        >
          {texts.noResults}
        </div>
      )}
      {!loading &&
        visibleResults.map((song, index) => {
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
                "full",
              )
            : null;
          const isActive = index === activeIndex;
          return (
            <button
              key={song.id}
              id={optionId(song.id)}
              type="button"
              role="option"
              aria-selected={isActive}
              // tabIndex=-1 keeps the option out of the tab order
              // so focus stays on the input (the canonical ARIA
              // combobox + aria-activedescendant pattern). Tab
              // from the input then moves OUT of the composite,
              // not through individual option buttons.
              tabIndex={-1}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => handleSelect(song)}
              className={
                isCompact
                  ? `w-full text-left px-2.5 py-1.5 ${
                      isActive ? "bg-gray-100" : "hover:bg-gray-50"
                    } active:bg-gray-100 border-b border-gray-100 last:border-b-0`
                  : `w-full text-left px-3 py-2 ${
                      isActive ? "bg-gray-100" : "hover:bg-gray-50"
                    } active:bg-gray-100 border-b border-gray-100 last:border-b-0`
              }
            >
              <div
                className={
                  isCompact
                    ? "text-xs font-medium text-gray-900"
                    : "text-sm font-medium text-gray-900"
                }
              >
                {title.main}
                {title.variant && (
                  <span className="text-gray-500">
                    {" "}
                    ({title.variant})
                  </span>
                )}
              </div>
              {(title.sub || artistName) && (
                <div
                  className={
                    isCompact
                      ? "text-[11px] text-gray-500 mt-0.5"
                      : "text-xs text-gray-500 mt-0.5"
                  }
                >
                  {title.sub && <span>{title.sub}</span>}
                  {title.sub && artistName && <span> · </span>}
                  {artistName && <span>{artistName}</span>}
                </div>
              )}
            </button>
          );
        })}
    </div>
  );

  return (
    <div ref={containerRef} className="relative w-full">
      <input
        type="text"
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => {
          setOpen(true);
          if (isCompact) setInputFocused(true);
        }}
        onBlur={() => {
          if (isCompact) setInputFocused(false);
        }}
        onKeyDown={handleKeyDown}
        placeholder={texts.placeholder}
        // Compact: pill-shaped 12px input matching the mockup's
        // InlineSongSearch. Border color is driven from the
        // `colors.wishlist*` tokens via inline `style` so the hex
        // literal lives in `tokens.ts` only — no Tailwind
        // arbitrary-value duplication. `:focus` can't be expressed
        // in inline style, so the focus color toggles via the
        // `inputFocused` state set by the onFocus/onBlur handlers
        // above.
        // Default: admin-form sized — keeps Tailwind classes since
        // its colors are project-grays already covered by Tailwind.
        className={
          isCompact
            ? "w-full px-2.5 py-1 text-xs border rounded-full text-slate-900 bg-white focus:outline-none"
            : "w-full px-3 py-2 text-base border border-gray-300 rounded-md focus:outline-none focus:border-gray-500"
        }
        style={
          isCompact
            ? {
                borderColor: inputFocused
                  ? colors.wishlistFocusBorder
                  : colors.wishlistBorder,
              }
            : undefined
        }
        // React handles the `autoFocus` attribute as a mount-time
        // imperative `.focus()` call — no need for a ref.
        autoFocus={autoFocus}
        aria-label={texts.placeholder}
        role="combobox"
        aria-expanded={open && hasQuery}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeOptionId}
      />
      {/* Dropdown renders into `document.body` via createPortal so
          ancestor `overflow: hidden` (wishlist card, live-setlist
          section) can't clip the listbox to the input's host card.
          The position is computed from the input's bounding rect
          (see useLayoutEffect above) so the dropdown still tracks
          the input visually. The portal-target is gated on
          `mounted` to keep SSR safe — server has no `document.body`.

          Result-list rendering, ARIA, keyboard nav, debounce, abort
          all unchanged from the pre-portal flow; only the parent
          element + position strategy moved. */}
      {mounted && dropdown && createPortal(dropdown, document.body)}
    </div>
  );
}
