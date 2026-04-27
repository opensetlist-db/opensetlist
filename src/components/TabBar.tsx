"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { colors, radius, shadows } from "@/styles/tokens";

/*
 * Single-row tab navigation used by detail pages (Artist / Member /
 * Song / Series) and legal-pages mobile. URL-sync'd via `?tab=...`
 * so deep-links and back/forward navigation work without any
 * per-page state management.
 *
 * Active tab: blue background + white label.
 * Inactive: transparent + muted text.
 * Wrapper: white card with subtle shadow and `radius: 12`.
 *
 * Why client component: the active state is read from the live URL
 * via useSearchParams, which can't run in a server component. The
 * component is intentionally state-free — clicking a tab pushes a
 * new URL and Next.js re-renders the page with the new ?tab value.
 *
 * The page reads the same `?tab` server-side from `searchParams` to
 * decide which tab content to render. Default tab (no `?tab` set)
 * is the first entry in `tabs`.
 */

interface Tab {
  key: string;
  label: string;
}

interface Props {
  tabs: ReadonlyArray<Tab>;
  active: string;
  /**
   * Translated `aria-label` for the wrapping `<nav>`. Required (not
   * defaulted to a literal "Tabs") so screen readers expose a
   * locale-correct value — a default English string would leak
   * through on ko/ja pages. Resolve via `getTranslations("Common")`
   * → `ct("tabsAriaLabel")` (or the page's own namespace).
   */
  ariaLabel: string;
  /**
   * URL search-param name. Defaults to "tab"; override when the page
   * needs a different param (e.g. song page might use "view" if
   * "tab" is taken by a parent context). Same param goes server-side
   * + client-side so the active highlight matches what's rendered.
   */
  paramName?: string;
}

export function TabBar({
  tabs,
  active,
  ariaLabel,
  paramName = "tab",
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handleClick = (key: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set(paramName, key);
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  };

  // Intentionally NOT using `role="tablist"` / `role="tab"` /
  // `aria-selected`. The WAI-ARIA tab pattern requires the tab
  // panels to live in the same DOM tree with `aria-controls` wiring
  // and arrow-key roving focus — but our "tabs" are really
  // server-routed navigation: clicking pushes a new URL and the
  // page re-renders the chosen content from a fresh server pass.
  // Promising tab semantics here would mislead screen readers about
  // the keyboard interaction model. Plain `<nav>` + buttons with
  // `aria-current="page"` is the honest representation.
  return (
    <nav
      aria-label={ariaLabel}
      style={{
        display: "flex",
        gap: 0,
        background: colors.bgCard,
        borderRadius: 12,
        padding: 4,
        marginBottom: 16,
        boxShadow: shadows.nav,
      }}
    >
      {tabs.map((tab) => {
        const isActive = active === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            aria-current={isActive ? "page" : undefined}
            onClick={() => handleClick(tab.key)}
            style={{
              flex: 1,
              padding: "8px 0",
              borderRadius: radius.tag - 2,
              border: "none",
              background: isActive ? colors.primary : "transparent",
              color: isActive ? "white" : colors.textSubtle,
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
              transition: "background 0.15s ease, color 0.15s ease",
              fontFamily: "inherit",
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
