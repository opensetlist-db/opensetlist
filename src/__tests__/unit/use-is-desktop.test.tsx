import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useIsDesktop } from "@/hooks/useIsDesktop";
import { breakpoint } from "@/styles/tokens";

// jsdom's default innerWidth happens to equal `breakpoint.desktop` (1024).
// Set explicitly per test so behavior is deterministic regardless of jsdom
// version drift, and reference the token so a future change to
// `breakpoint.desktop` doesn't silently invalidate the tests.
function setInnerWidth(px: number) {
  Object.defineProperty(window, "innerWidth", {
    value: px,
    configurable: true,
    writable: true,
  });
}

const DESKTOP = breakpoint.desktop;
const BELOW = DESKTOP - 1;
const ABOVE = DESKTOP + 256;

describe("useIsDesktop", () => {
  beforeEach(() => {
    setInnerWidth(DESKTOP);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns false when innerWidth is below the breakpoint", () => {
    setInnerWidth(BELOW);
    const { result } = renderHook(() => useIsDesktop(DESKTOP));
    expect(result.current).toBe(false);
  });

  it("returns true when innerWidth is at or above the breakpoint", () => {
    setInnerWidth(ABOVE);
    const { result } = renderHook(() => useIsDesktop(DESKTOP));
    expect(result.current).toBe(true);
  });

  it("uses the tokens default breakpoint when no argument is passed", () => {
    setInnerWidth(DESKTOP);
    const { result } = renderHook(() => useIsDesktop());
    expect(result.current).toBe(true);
  });

  it("re-renders on window resize", () => {
    setInnerWidth(BELOW);
    const { result } = renderHook(() => useIsDesktop(DESKTOP));
    expect(result.current).toBe(false);

    act(() => {
      setInnerWidth(ABOVE);
      window.dispatchEvent(new Event("resize"));
    });
    expect(result.current).toBe(true);

    act(() => {
      setInnerWidth(BELOW);
      window.dispatchEvent(new Event("resize"));
    });
    expect(result.current).toBe(false);
  });

  it("attaches and detaches the resize listener (no leak)", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");

    const { unmount } = renderHook(() => useIsDesktop(DESKTOP));
    expect(
      addSpy.mock.calls.some(([type]) => type === "resize"),
    ).toBe(true);

    unmount();
    expect(
      removeSpy.mock.calls.some(([type]) => type === "resize"),
    ).toBe(true);
  });
});
