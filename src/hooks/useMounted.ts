"use client";

import { useSyncExternalStore } from "react";

const subscribe = (): (() => void) => () => {};
const getServerSnapshot = (): boolean => false;
const getClientSnapshot = (): boolean => true;

/**
 * Hydration-safe client-only flag — `false` during SSR + the initial client
 * render (so server/client HTML matches), `true` from the first commit
 * onward. The canonical React 18+ replacement for the
 *
 *   const [mounted, setMounted] = useState(false);
 *   useEffect(() => setMounted(true), []);
 *
 * pattern, which trips `react-hooks/set-state-in-effect`.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
}
