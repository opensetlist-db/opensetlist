type GtagParams = Record<string, string | number | boolean>;

declare global {
  interface Window {
    gtag?: (command: "event", eventName: string, params?: GtagParams) => void;
  }
}

const FIRST_VISIT_KEY = "opensetlist_first_visit";

export function trackEvent(eventName: string, params?: GtagParams): void {
  if (typeof window === "undefined") return;
  if (typeof window.gtag !== "function") return;
  try {
    window.gtag("event", eventName, params);
  } catch {
    // Analytics must never surface an error to the user.
  }
}

export function recordFirstVisit(): void {
  if (typeof window === "undefined") return;
  try {
    if (!localStorage.getItem(FIRST_VISIT_KEY)) {
      localStorage.setItem(FIRST_VISIT_KEY, new Date().toISOString());
    }
  } catch {
    // localStorage may be disabled (private mode, quota, etc.)
  }
}

export function getFirstVisitDate(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(FIRST_VISIT_KEY);
  } catch {
    return null;
  }
}

export { FIRST_VISIT_KEY };
