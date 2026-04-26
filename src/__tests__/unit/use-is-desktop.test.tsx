import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useIsDesktop } from "@/hooks/useIsDesktop";

// jsdom's default innerWidth is 1024. Set explicitly per test so
// behavior is deterministic regardless of jsdom version drift.
function setInnerWidth(px: number) {
  Object.defineProperty(window, "innerWidth", {
    value: px,
    configurable: true,
    writable: true,
  });
}

describe("useIsDesktop", () => {
  beforeEach(() => {
    setInnerWidth(1024);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns false when innerWidth is below the breakpoint", () => {
    setInnerWidth(600);
    const { result } = renderHook(() => useIsDesktop(1024));
    expect(result.current).toBe(false);
  });

  it("returns true when innerWidth is at or above the breakpoint", () => {
    setInnerWidth(1280);
    const { result } = renderHook(() => useIsDesktop(1024));
    expect(result.current).toBe(true);
  });

  it("uses the tokens default breakpoint (1024) when no argument is passed", () => {
    setInnerWidth(1024);
    const { result } = renderHook(() => useIsDesktop());
    expect(result.current).toBe(true);
  });

  it("re-renders on window resize", () => {
    setInnerWidth(600);
    const { result } = renderHook(() => useIsDesktop(1024));
    expect(result.current).toBe(false);

    act(() => {
      setInnerWidth(1280);
      window.dispatchEvent(new Event("resize"));
    });
    expect(result.current).toBe(true);

    act(() => {
      setInnerWidth(500);
      window.dispatchEvent(new Event("resize"));
    });
    expect(result.current).toBe(false);
  });

  it("attaches and detaches the resize listener (no leak)", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");

    const { unmount } = renderHook(() => useIsDesktop(1024));
    expect(
      addSpy.mock.calls.some(([type]) => type === "resize"),
    ).toBe(true);

    unmount();
    expect(
      removeSpy.mock.calls.some(([type]) => type === "resize"),
    ).toBe(true);
  });
});
