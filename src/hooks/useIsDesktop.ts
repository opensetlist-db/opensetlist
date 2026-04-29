"use client";

import { useSyncExternalStore } from "react";
import { breakpoint } from "@/styles/tokens";

/*
 * Subscribes to viewport resize and returns whether the viewport is at
 * or above the desktop breakpoint. SSR-safe: the server snapshot is
 * always `false`, so the initial client render matches the server HTML
 * and avoids hydration mismatch. After hydration, the resize listener
 * flips the value if the actual viewport is desktop-sized — desktop
 * users see one frame of mobile layout, which is the documented
 * trade-off for SSR-rendered responsive components (handoff §12).
 *
 * Uses `useSyncExternalStore` over the
 *   useState(false) + useEffect(setIsDesktop(...)) + addEventListener
 * pattern from the handoff to avoid `react-hooks/set-state-in-effect`
 * (the same lint rule that `useMounted.ts` solves the same way).
 */

function subscribe(callback: () => void): () => void {
  window.addEventListener("resize", callback);
  return () => window.removeEventListener("resize", callback);
}

const getServerSnapshot = (): boolean => false;

export function useIsDesktop(
  breakpointPx: number = breakpoint.desktop,
): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.innerWidth >= breakpointPx,
    getServerSnapshot,
  );
}
