import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Hoisted-mock pattern: vi.mock factories run before module imports,
// so we can't reference top-level locals from inside them. Instead
// the mock writes the live flag value through a `vi.hoisted` shim
// that's itself set up before the factory runs. Each test mutates
// `flagState.value` before mounting the hook to drive the gated POST
// path.
const flagState = vi.hoisted(() => ({ value: false }));
vi.mock("@/lib/launchFlags", () => ({
  get LAUNCH_FLAGS() {
    return { showSignIn: false, showSearch: false, confirmDbEnabled: flagState.value };
  },
}));

// `useMounted` returns false on SSR + the initial commit; in the
// test environment we want it to immediately read true so the
// hydration-gate fires in the same render the hook is mounted.
vi.mock("@/hooks/useMounted", () => ({
  useMounted: () => true,
}));

import { confirmKey, useLocalConfirm } from "@/hooks/useLocalConfirm";

beforeEach(() => {
  window.localStorage.clear();
  flagState.value = false;
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}")));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("confirmKey", () => {
  it("namespaces by eventId", () => {
    expect(confirmKey("42")).toBe("confirm-42");
  });
});

describe("useLocalConfirm hydration", () => {
  it("hydrates the empty set when no localStorage entry exists", () => {
    const { result } = renderHook(() => useLocalConfirm("1"));
    expect(result.current.confirmedItemIds.size).toBe(0);
  });

  it("hydrates from a pre-existing localStorage payload on mount", () => {
    window.localStorage.setItem("confirm-1", JSON.stringify([10, 20, 30]));
    const { result } = renderHook(() => useLocalConfirm("1"));
    expect([...result.current.confirmedItemIds].sort()).toEqual([10, 20, 30]);
  });

  it("scopes by eventId — confirms for one event don't leak to another", () => {
    window.localStorage.setItem("confirm-1", JSON.stringify([10]));
    window.localStorage.setItem("confirm-2", JSON.stringify([20]));
    const { result: r1 } = renderHook(() => useLocalConfirm("1"));
    const { result: r2 } = renderHook(() => useLocalConfirm("2"));
    expect([...r1.current.confirmedItemIds]).toEqual([10]);
    expect([...r2.current.confirmedItemIds]).toEqual([20]);
  });

  it("survives a malformed JSON payload defensively (returns empty set)", () => {
    window.localStorage.setItem("confirm-1", "not-json{");
    const { result } = renderHook(() => useLocalConfirm("1"));
    expect(result.current.confirmedItemIds.size).toBe(0);
  });

  it("filters NaN / non-finite ids from a tampered payload", () => {
    // DevTools-tampered payload that injected non-numbers; the hook
    // should drop them rather than allow `Set.has(NaN)` lookups
    // downstream.
    window.localStorage.setItem(
      "confirm-1",
      JSON.stringify([10, null, "string", 20]),
    );
    const { result } = renderHook(() => useLocalConfirm("1"));
    expect([...result.current.confirmedItemIds].sort()).toEqual([10, 20]);
  });
});

describe("useLocalConfirm.toggleConfirm", () => {
  it("adds an id on first toggle and persists to localStorage", () => {
    const { result } = renderHook(() => useLocalConfirm("1"));
    act(() => result.current.toggleConfirm(42));
    expect(result.current.confirmedItemIds.has(42)).toBe(true);
    const stored = JSON.parse(window.localStorage.getItem("confirm-1")!);
    expect(stored).toEqual([42]);
  });

  it("removes an id on second toggle (cancel-confirm at 1B/1C is local-only)", () => {
    window.localStorage.setItem("confirm-1", JSON.stringify([42]));
    const { result } = renderHook(() => useLocalConfirm("1"));
    act(() => result.current.toggleConfirm(42));
    expect(result.current.confirmedItemIds.has(42)).toBe(false);
    const stored = JSON.parse(window.localStorage.getItem("confirm-1")!);
    expect(stored).toEqual([]);
  });

  it("is idempotent across add+remove (round-trip leaves no residue)", () => {
    const { result } = renderHook(() => useLocalConfirm("1"));
    act(() => result.current.toggleConfirm(42));
    act(() => result.current.toggleConfirm(42));
    act(() => result.current.toggleConfirm(42));
    act(() => result.current.toggleConfirm(42));
    expect(result.current.confirmedItemIds.size).toBe(0);
  });
});

describe("useLocalConfirm POST gating", () => {
  it("does NOT fire POST when confirmDbEnabled is false (5/23 Kobe simulation)", () => {
    flagState.value = false;
    const { result } = renderHook(() => useLocalConfirm("1"));
    act(() => result.current.toggleConfirm(42));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fires POST to /api/setlist-items/X/confirm when confirmDbEnabled is true (5/30 Kanagawa simulation)", () => {
    flagState.value = true;
    const { result } = renderHook(() => useLocalConfirm("1"));
    act(() => result.current.toggleConfirm(42));
    expect(fetch).toHaveBeenCalledWith(
      "/api/setlist-items/42/confirm",
      { method: "POST" },
    );
  });

  it("does NOT fire POST on the cancel side (DELETE deferred to Phase 2)", () => {
    // Pre-seed so the toggle is a removal.
    window.localStorage.setItem("confirm-1", JSON.stringify([42]));
    flagState.value = true;
    const { result } = renderHook(() => useLocalConfirm("1"));
    act(() => result.current.toggleConfirm(42));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("swallows POST network errors silently — UI optimistic update is preserved", async () => {
    flagState.value = true;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );
    const { result } = renderHook(() => useLocalConfirm("1"));
    // Should not throw; act flushes the synchronous setState. The
    // promise rejection settles in the next microtask but the .catch
    // handler swallows it so Vitest doesn't report an unhandled
    // rejection.
    act(() => result.current.toggleConfirm(42));
    await Promise.resolve();
    expect(result.current.confirmedItemIds.has(42)).toBe(true);
  });
});
