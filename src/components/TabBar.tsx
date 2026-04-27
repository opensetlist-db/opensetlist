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
   * URL search-param name. Defaults to "tab"; override when the page
   * needs a different param (e.g. song page might use "view" if
   * "tab" is taken by a parent context). Same param goes server-side
   * + client-side so the active highlight matches what's rendered.
   */
  paramName?: string;
}

export function TabBar({ tabs, active, paramName = "tab" }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handleClick = (key: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set(paramName, key);
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  };

  return (
    <div
      role="tablist"
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
            role="tab"
            aria-selected={isActive}
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
    </div>
  );
}
