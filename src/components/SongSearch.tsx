"use client";

import {
  useId,
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { josa } from "es-hangul";
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
//
// v2 strings (variantPicker* / create*) are optional — only required
// when the caller opts into `variantPicker` / `allowCreate`. v1 callers
// (wishlist / prediction / admin SetlistBuilder) keep their existing
// 3-key shape with no changes.
//
// IMPORTANT — no hardcoded language fallbacks. If a v2-opting caller
// omits one of these strings, the component renders the row empty
// rather than fall back to a Korean default. CLAUDE.md requires
// user-facing surfaces to be strictly i18n-keyed, and a "Korean leak"
// for a ja/en caller that forgets a key would silently violate that
// rule. Empty UI is a visible bug; a Korean leak is invisible to a
// Korean-reading reviewer. Consumers using `useTranslations("SongSearch")`
// get every key from the locale's messages file, so the empty-string
// branch only fires for misconfigured callers.
export interface SongSearchTexts {
  placeholder: string;
  loading: string;
  noResults: string;
  variantPickerTitle?: string;
  variantPickerBack?: string;
  variantPickerOriginalLabel?: string;
  createSongRow?: string;
  createVariantRow?: string;
  createDisabledTooltip?: string;
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
  // Populated only when the route was called with `expandVariants=true`.
  // v1 callers (admin / wishlist / prediction) leave this undefined; v2
  // callers (AddItemBottomSheet) get a (possibly empty) array of child
  // variants ordered by id ascending. An empty array = base has no
  // recorded variants; an undefined value = the API was not asked for
  // expansion (the picker treats both the same way: skip stage 2).
  variants?: SongVariant[];
}

// Child-variant subset, returned only when the API is called with
// `expandVariants=true`. Shape mirrors the route's nested select —
// just enough for the picker's row labels + the consumer's variantId.
export interface SongVariant {
  id: number;
  variantLabel: string | null;
  translations: {
    locale: string;
    title: string;
    variantLabel: string | null;
  }[];
}

interface SongSearchProps {
  // v2 onSelect: optional `variant` second arg. `undefined` means either
  // (a) the song has no recorded variants → no stage 2; or (b) the user
  // picked 원곡 in stage 2. Consumers treat both as variantId=null —
  // single downstream branch (per plan §1: confirmed by owner).
  // v1 callers' `(song) => void` handlers continue to work — TS allows
  // passing an extra arg the receiver ignores.
  onSelect: (song: SongSearchResult, variant?: SongVariant) => void;
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
  // v2: enable the two-stage variant picker. When true, the route is
  // called with `expandVariants=true` so each base row carries its
  // child variants in `.variants`. On a stage-1 pick:
  //   - `song.variants` empty/undefined → fire `onSelect(song, undefined)`
  //     immediately (no stage 2);
  //   - otherwise → render stage 2 (원곡 + each variant) and fire
  //     `onSelect(pickedBase, chosen)` on the user's pick (chosen is
  //     `undefined` for 원곡, the variant object otherwise).
  // Independent of `includeVariants`; v1 callers leave both false.
  variantPicker?: boolean;
  // v2: render disabled "+ new song / + new variant" rows at the
  // bottom of stage 1 / stage 2 to reserve the future-slot visually.
  // Click is a no-op; rows carry aria-disabled + a Phase-2-tooltip.
  // Independent of `variantPicker`. Wishlist + prediction leave this
  // false (no slot rendered at all).
  allowCreate?: boolean;
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
  variantPicker = false,
  allowCreate = false,
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
  // v2 two-stage picker state. "search" = stage 1 (default; the v1 flow).
  // "variant" = stage 2; rendered iff the user picked a base that has
  // recorded variants. `pickedBase` holds the stage-1 selection so
  // stage 2 can render its title + emit the onSelect with the right
  // parent song. Both reset on back-link / pick / new-query.
  const [stage, setStage] = useState<"search" | "variant">("search");
  const [pickedBase, setPickedBase] = useState<SongSearchResult | null>(null);
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
  // Document-relative coords for the portalled dropdown (rendered with
  // `position: absolute`). Recomputed on open + layout-shifting events
  // (window scroll, resize, visualViewport scroll/resize) so the
  // dropdown tracks the input through keyboard transitions and content
  // reflow. With absolute positioning + doc coords the dropdown
  // scrolls naturally WITH the page (the input is also in document
  // flow, so they stay aligned automatically) — see the
  // `useLayoutEffect` docstring below for the iOS Safari soft-keyboard
  // rationale that drove the switch from `position: fixed` to
  // `position: absolute`. Closing the dropdown on scroll would be
  // simpler but harms mobile UX: virtual-keyboard show/hide fires
  // scroll-class events, and we don't want the dropdown to vanish out
  // from under the user every keystroke.
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
      // v2: only ask the API to expand nested variants when the picker
      // is actually going to render stage 2. Saves the variant join for
      // v1 callers (wishlist, prediction, admin) on every keystroke.
      if (variantPicker) params.set("expandVariants", "true");
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
    [includeVariants, variantPicker, excludeSongIds],
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
    // v2: typing while parked on stage 2 means the user changed their
    // mind — drop back to stage 1 so the new query drives stage-1
    // results, not stage-2's frozen variant list for the previous pick.
    if (stage !== "search") {
      setStage("search");
      setPickedBase(null);
    }
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

  // Common teardown after the consumer has been notified — clears
  // dropdown state and cancels any racing fetch. Shared between the
  // v1 single-stage path and both v2 stage-2 branches (원곡 / variant).
  function finishSelect() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (abortRef.current) abortRef.current.abort();
    setQuery("");
    setResults([]);
    setLoading(false);
    setOpen(false);
    setActiveIndex(-1);
    setStage("search");
    setPickedBase(null);
  }

  // Stage-1 row click. v1 callers (`variantPicker=false`) always emit
  // and tear down here. v2 callers branch on whether the picked base
  // has child variants — empty → emit immediately (no stage 2); else
  // park on stage 2 with the input cleared of typing state but the
  // query string preserved so the back-link returns to the same
  // stage-1 result set.
  //
  // Arity note: v1 callers' onSelect is typed `(song) => void` and
  // their tests assert `toHaveBeenCalledWith(song)` — strict on
  // argument count. We invoke with exactly one arg when variantPicker
  // is off so that strict-arity check stays valid. v2 callers get
  // `(song, undefined)` in the no-variants branch, matching the plan
  // §1 contract.
  function handleResultClick(song: SongSearchResult) {
    if (variantPicker) {
      const childVariants = song.variants ?? [];
      if (childVariants.length > 0) {
        setPickedBase(song);
        setStage("variant");
        // Reset row highlight: stage 2 has a different list, the
        // stage-1 index would point at a wrong row otherwise.
        setActiveIndex(-1);
        return;
      }
      onSelect(song, undefined);
    } else {
      onSelect(song);
    }
    finishSelect();
  }

  // Stage-2 row click. `variant === undefined` is the 원곡 (base) row —
  // per the plan §1 owner decision, this fires `onSelect(song, undefined)`
  // so the consumer's `variantId` is null in both the no-variants and
  // base-picked paths (single downstream branch).
  function handleVariantClick(variant: SongVariant | undefined) {
    if (!pickedBase) return;
    onSelect(pickedBase, variant);
    finishSelect();
  }

  // Back-link from stage 2 → stage 1. Preserves the user's query so
  // the stage-1 result list reappears immediately (no re-fetch needed
  // because `results` is still the stage-1 payload — we never refetched
  // when transitioning to stage 2).
  function handleBackToSearch() {
    setStage("search");
    setPickedBase(null);
    setActiveIndex(-1);
  }

  // Belt-and-suspenders: the API filters excludeIds, but a stale
  // response from a query mid-flight at the moment of a select could
  // briefly show the just-picked row. Filter again on render.
  const visibleResults = results.filter(
    (r) => !excludeSongIds.includes(r.id),
  );

  const hasQuery = query.trim().length > 0;
  // Stable, scoped option IDs. Songs and variants live in disjoint
  // BigInt key spaces (separate Prisma tables would not collide; same
  // table here, but a base and one of its variants are still distinct
  // rows with distinct ids) — adding a kind prefix is belt-and-
  // suspenders for the future where a variant could theoretically
  // share an id range, and keeps the IDs readable for debugging.
  const optionId = (songId: number) => `${listboxId}-option-${songId}`;
  const variantOptionId = (variantId: number | "original") =>
    `${listboxId}-variant-${variantId}`;

  // Stage-2 navigable rows: 원곡 first (sentinel `undefined`), then each
  // recorded variant in API order. activeIndex into this list maps to
  // `variantOptions[activeIndex]` — `undefined` at index 0 fires
  // onSelect(base, undefined); a variant object fires onSelect(base, v).
  const variantOptions: (SongVariant | undefined)[] =
    stage === "variant" && pickedBase
      ? [undefined, ...(pickedBase.variants ?? [])]
      : [];

  // Active row length depends on the stage. Stage 1 navigates result
  // rows; stage 2 navigates 원곡 + variants. Disabled future-slot rows
  // are intentionally excluded from navigation (they're not actionable
  // at 1C — keyboard would be a confusing affordance).
  const navigableLength =
    stage === "search" ? visibleResults.length : variantOptions.length;

  // aria-activedescendant must point only at a DOM element that
  // actually exists. The listbox renders iff `open && hasQuery`, so
  // gate the descendant id on the same condition — otherwise a
  // click-outside (which closes via setOpen(false) but leaves
  // activeIndex untouched) would leave aria-activedescendant
  // referencing an id that's no longer in the tree.
  const activeOptionId = (() => {
    if (!open || !hasQuery) return undefined;
    if (activeIndex < 0 || activeIndex >= navigableLength) return undefined;
    if (stage === "search") {
      return optionId(visibleResults[activeIndex].id);
    }
    // Stage 2.
    const v = variantOptions[activeIndex];
    return variantOptionId(v ? v.id : "original");
  })();

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      // Wrap-around vs clamp: clamp keeps things predictable on small
      // result sets (Down at the bottom doesn't jump back to top).
      setActiveIndex((prev) => Math.min(prev + 1, navigableLength - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      if (activeIndex < 0 || activeIndex >= navigableLength) return;
      e.preventDefault();
      if (stage === "search") {
        handleResultClick(visibleResults[activeIndex]);
      } else {
        handleVariantClick(variantOptions[activeIndex]);
      }
    } else if (e.key === "Escape") {
      // Don't preventDefault unconditionally — if the dropdown is
      // already closed, let Escape bubble (some parent forms wire
      // Esc to cancel/close themselves).
      // Stage 2: Escape backs up to stage 1 (matching the back-link),
      // not "close the dropdown" — saves the user a re-search if they
      // hit Esc by reflex.
      if (open && stage === "variant") {
        e.preventDefault();
        handleBackToSearch();
        return;
      }
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
    // Pick the active row's DOM id based on stage. Stage 1: the song
    // option id; stage 2: the variant option id (or "original" sentinel
    // for the 원곡 row).
    let elId: string | null = null;
    if (stage === "search") {
      const song = visibleResults[activeIndex];
      if (song) elId = optionId(song.id);
    } else {
      const v = variantOptions[activeIndex];
      // `v === undefined` at index 0 = 원곡 row.
      if (activeIndex < variantOptions.length) {
        elId = variantOptionId(v ? v.id : "original");
      }
    }
    if (!elId) return;
    const el = document.getElementById(elId);
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest" });
    }
    // optionId/variantOptionId close over listboxId; `pickedBase` (not
    // `variantOptions`, which is a fresh array per render) is the
    // structural input that changes the stage-2 row identity set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, stage, visibleResults, pickedBase]);

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
      const top = rect.bottom + window.scrollY + 4;
      const left = rect.left + window.scrollX;
      const width = rect.width;
      // Equality guard: visualViewport scroll/resize events fire
      // rapidly during iOS keyboard transitions, and a no-op
      // `setState({ ... })` with structurally-equal-but-fresh object
      // would still re-render the dropdown subtree on every event.
      // Functional setState compares the three numeric fields and
      // returns the prior reference when nothing changed — React
      // bails out on identity equality and skips the render.
      setDropdownPos((prev) =>
        prev &&
        prev.top === top &&
        prev.left === left &&
        prev.width === width
          ? prev
          : { top, left, width },
      );
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

  // Variant-row label resolution: prefer the locale-matched translation
  // from SongTranslation.variantLabel; fall back to the source-language
  // variantLabel; final fallback is the 원곡 label (which the picker
  // should never actually hit for child variants, but defensive code is
  // cheap). 원곡 (the base) is handled separately via a sentinel row
  // and uses `texts.variantPickerOriginalLabel` directly.
  function resolveVariantLabel(v: SongVariant): string {
    const localized = v.translations.find((t) => t.locale === locale);
    // No hardcoded language fallback — see the SongSearchTexts comment.
    // Empty string would be a data bug (variants are required to have a
    // label by domain rules); falling back to a Korean "원곡" would
    // silently leak Korean into a ja/en surface, which is worse.
    return localized?.variantLabel || v.variantLabel || "";
  }

  // Future-slot rows are intentionally non-interactive at 1C — they
  // reserve the visual slot so Phase 2's lit-up workflow doesn't shift
  // the rest of the UI. `aria-disabled` + `tabIndex=-1` keep them out
  // of keyboard focus + screenreader actionable tree; the click handler
  // is a no-op (no toast, no setState — the tooltip is the affordance).
  function renderCreateRow(kind: "song" | "variant"): ReactNode {
    if (!allowCreate) return null;
    let label: string | undefined;
    if (kind === "song") {
      label = texts.createSongRow?.replace("{query}", query.trim());
    } else {
      // Variant row: Korean object particle 을/를 needs to follow the
      // user's query. `josa(query, "을/를")` picks the right one based
      // on the last char's jongseong (per CLAUDE.md feedback rule).
      // The locale's `createVariantRow` string has `{query}` and an
      // explicit `{josa}` placeholder we substitute here — keeps the
      // grammar correct for ko, and the placeholder is a no-op for
      // ja/en where the string ignores it.
      const q = query.trim();
      const particle = q ? josa(q, "을/를").slice(q.length) : "";
      label = texts.createVariantRow
        ?.replace("{query}", q)
        .replace("{josa}", particle);
    }
    if (!label) return null;
    const tooltip = texts.createDisabledTooltip;
    return (
      <div
        role="option"
        aria-disabled="true"
        tabIndex={-1}
        title={tooltip}
        className={
          isCompact
            ? "px-2.5 py-1.5 text-xs text-gray-400 cursor-not-allowed border-t border-gray-100"
            : "px-3 py-2 text-sm text-gray-400 cursor-not-allowed border-t border-gray-100"
        }
        // Block stray mousedown so a click on the disabled row can't
        // trip the click-outside handler before the tooltip shows.
        onMouseDown={(e) => e.preventDefault()}
      >
        {label}
      </div>
    );
  }

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
      {stage === "search" && (
        <>
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
                  onClick={() => handleResultClick(song)}
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
          {!loading && renderCreateRow("song")}
        </>
      )}

      {stage === "variant" && pickedBase && (
        <>
          {/* Back-link row to return to stage 1. Rendered as a button
              (not a link) so it lives inside the same listbox container
              and inherits the click-outside guard. tabIndex=-1 keeps it
              out of the keyboard navigation list — Escape is the
              keyboard affordance for going back (handled in
              handleKeyDown). */}
          <button
            type="button"
            tabIndex={-1}
            onClick={handleBackToSearch}
            className={
              isCompact
                ? "w-full text-left px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50 border-b border-gray-100"
                : "w-full text-left px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 border-b border-gray-100"
            }
          >
            {texts.variantPickerBack ?? ""}
          </button>
          {/* Stage-2 header: the picked base's title. Decorative — the
              picker's job is to disambiguate WHICH version of this
              song, so showing the base's title up top reinforces the
              context the user just came from. */}
          <div
            className={
              isCompact
                ? "px-2.5 py-1.5 border-b border-gray-100"
                : "px-3 py-2 border-b border-gray-100"
            }
          >
            <div
              className={
                isCompact
                  ? "text-[11px] uppercase tracking-wide text-gray-500"
                  : "text-xs uppercase tracking-wide text-gray-500"
              }
            >
              {texts.variantPickerTitle ?? ""}
            </div>
            <div
              className={
                isCompact
                  ? "text-xs font-medium text-gray-900 mt-0.5"
                  : "text-sm font-medium text-gray-900 mt-0.5"
              }
            >
              {(() => {
                const t = displayOriginalTitle(
                  {
                    originalTitle: pickedBase.originalTitle,
                    originalLanguage: pickedBase.originalLanguage,
                    variantLabel: pickedBase.variantLabel,
                  },
                  pickedBase.translations,
                  locale,
                );
                return t.main;
              })()}
            </div>
          </div>
          {/* Variant rows: 원곡 first (sentinel), then each child
              variant. Same role="option" + aria-selected pattern as
              stage-1 rows so the keyboard nav from the input behaves
              identically. */}
          {variantOptions.map((v, index) => {
            const isActive = index === activeIndex;
            const isOriginal = v === undefined;
            const label = isOriginal
              ? texts.variantPickerOriginalLabel ?? ""
              : resolveVariantLabel(v);
            return (
              <button
                key={isOriginal ? "original" : v.id}
                id={variantOptionId(isOriginal ? "original" : v.id)}
                type="button"
                role="option"
                aria-selected={isActive}
                tabIndex={-1}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => handleVariantClick(v)}
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
                  {label}
                </div>
              </button>
            );
          })}
          {renderCreateRow("variant")}
        </>
      )}
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
