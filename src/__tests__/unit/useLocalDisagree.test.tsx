import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

// `useMounted` returns false on SSR + the initial commit; the test
// environment forces it to true so the hydration gate fires in the
// same render the hook is mounted. Same shape as
// useLocalConfirm.test.tsx.
vi.mock("@/hooks/useMounted", () => ({
  useMounted: () => true,
}));

import { disagreeKey, useLocalDisagree } from "@/hooks/useLocalDisagree";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("disagreeKey", () => {
  it("namespaces by eventId", () => {
    expect(disagreeKey("42")).toBe("disagree-42");
  });
});

describe("useLocalDisagree hydration", () => {
  it("hydrates the empty set when no localStorage entry exists", () => {
    const { result } = renderHook(() => useLocalDisagree("1"));
    expect(result.current.disagreedItemIds.size).toBe(0);
  });

  it("hydrates from a pre-existing localStorage payload on mount", () => {
    window.localStorage.setItem("disagree-1", JSON.stringify([10, 20, 30]));
    const { result } = renderHook(() => useLocalDisagree("1"));
    expect([...result.current.disagreedItemIds].sort()).toEqual([10, 20, 30]);
  });

  it("scopes by eventId — disagrees for one event don't leak to another", () => {
    window.localStorage.setItem("disagree-1", JSON.stringify([10]));
    window.localStorage.setItem("disagree-2", JSON.stringify([20]));
    const { result: r1 } = renderHook(() => useLocalDisagree("1"));
    const { result: r2 } = renderHook(() => useLocalDisagree("2"));
    expect([...r1.current.disagreedItemIds]).toEqual([10]);
    expect([...r2.current.disagreedItemIds]).toEqual([20]);
  });

  it("survives a malformed JSON payload defensively (returns empty set)", () => {
    window.localStorage.setItem("disagree-1", "not-json{");
    const { result } = renderHook(() => useLocalDisagree("1"));
    expect(result.current.disagreedItemIds.size).toBe(0);
  });

  it("filters NaN / non-finite ids from a tampered payload", () => {
    window.localStorage.setItem(
      "disagree-1",
      JSON.stringify([10, null, "string", 20]),
    );
    const { result } = renderHook(() => useLocalDisagree("1"));
    expect([...result.current.disagreedItemIds].sort()).toEqual([10, 20]);
  });

  it("scopes by storage prefix — confirm and disagree don't collide", () => {
    // Independent storage keys means the two hooks coexist for the
    // same event without one's writes affecting the other's
    // hydration. The mutual-exclusivity rule (tap 👍 clears 👎) is
    // enforced at the consumer level, not in storage.
    window.localStorage.setItem("confirm-1", JSON.stringify([1, 2, 3]));
    window.localStorage.setItem("disagree-1", JSON.stringify([4, 5]));
    const { result } = renderHook(() => useLocalDisagree("1"));
    expect([...result.current.disagreedItemIds].sort()).toEqual([4, 5]);
  });
});

describe("useLocalDisagree.toggleDisagree", () => {
  it("adds an id on first toggle and persists to localStorage", () => {
    const { result } = renderHook(() => useLocalDisagree("1"));
    act(() => result.current.toggleDisagree(42));
    expect(result.current.disagreedItemIds.has(42)).toBe(true);
    const stored = JSON.parse(window.localStorage.getItem("disagree-1")!);
    expect(stored).toEqual([42]);
  });

  it("removes an id on second toggle (cancel-disagree is local-only)", () => {
    window.localStorage.setItem("disagree-1", JSON.stringify([42]));
    const { result } = renderHook(() => useLocalDisagree("1"));
    act(() => result.current.toggleDisagree(42));
    expect(result.current.disagreedItemIds.has(42)).toBe(false);
    const stored = JSON.parse(window.localStorage.getItem("disagree-1")!);
    expect(stored).toEqual([]);
  });

  it("is idempotent across add+remove (round-trip leaves no residue)", () => {
    const { result } = renderHook(() => useLocalDisagree("1"));
    act(() => result.current.toggleDisagree(42));
    act(() => result.current.toggleDisagree(42));
    act(() => result.current.toggleDisagree(42));
    act(() => result.current.toggleDisagree(42));
    expect(result.current.disagreedItemIds.size).toBe(0);
  });

  it("supports multiple distinct items independently", () => {
    const { result } = renderHook(() => useLocalDisagree("1"));
    act(() => result.current.toggleDisagree(10));
    act(() => result.current.toggleDisagree(20));
    expect([...result.current.disagreedItemIds].sort()).toEqual([10, 20]);
    act(() => result.current.toggleDisagree(10));
    expect([...result.current.disagreedItemIds]).toEqual([20]);
  });
});

describe("useLocalDisagree — no POST at v0.10.x", () => {
  it("never fires fetch (server-side aggregation deferred to Week 3)", () => {
    // Unlike useLocalConfirm which fires a gated POST when
    // `LAUNCH_FLAGS.confirmDbEnabled` is true, the disagree hook has
    // no POST endpoint yet. When Week 3 ships
    // `<AddItemBottomSheet>` and the conflict-resolution
    // aggregation, the equivalent gated fetch lands here.
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useLocalDisagree("1"));
    act(() => result.current.toggleDisagree(42));
    act(() => result.current.toggleDisagree(99));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
