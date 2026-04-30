import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import {
  ReactionButtons,
  REACTION_ACTIVE_COLOR,
  REACTION_ACTIVE_BG,
} from "@/components/ReactionButtons";
import { hexToRgbString } from "@/__tests__/utils/color";

const ACTIVE_COLOR_RGB = hexToRgbString(REACTION_ACTIVE_COLOR);
const ACTIVE_BG_RGB = hexToRgbString(REACTION_ACTIVE_BG);

// Minimal next-intl stub — title is the only prop ReactionButtons reads, and
// it's only used as a button `title` attribute, so identity-mapping is fine.
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

// Force "mounted" path so the component runs the hydration branch like it
// would in a real browser. Doesn't affect the prev-prop count sync, which is
// tested independently below.
vi.mock("@/hooks/useMounted", () => ({
  useMounted: () => true,
}));

vi.mock("@/lib/anonId", () => ({
  getAnonId: () => "test-anon-id",
}));

vi.mock("@/lib/analytics", () => ({
  trackEvent: vi.fn(),
}));

describe("ReactionButtons", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("re-syncs displayed counts when initialCounts prop reference changes (the polling fix)", () => {
    const { rerender } = render(
      <ReactionButtons
        setlistItemId="1"
        songId="100"
        eventId="42"
        initialCounts={{ best: 1 }}
      />,
    );

    // Per the REACTIONS list, 🔥 is the "best" reaction. ReactionButtons
    // renders the count as a sibling text node only when count > 0.
    const fireButton = screen.getByTitle("best");
    expect(fireButton.textContent).toContain("1");

    // Simulate a polling tick: parent passes a brand-new map with a higher
    // count. Before the fix, this stayed at 1 until remount.
    rerender(
      <ReactionButtons
        setlistItemId="1"
        songId="100"
        eventId="42"
        initialCounts={{ best: 5 }}
      />,
    );
    expect(screen.getByTitle("best").textContent).toContain("5");
  });

  it("does not show a count when prop drops to 0 (count-zero hidden by component)", () => {
    const { rerender } = render(
      <ReactionButtons
        setlistItemId="1"
        songId="100"
        eventId="42"
        initialCounts={{ best: 3 }}
      />,
    );
    expect(screen.getByTitle("best").textContent).toContain("3");

    rerender(
      <ReactionButtons
        setlistItemId="1"
        songId="100"
        eventId="42"
        initialCounts={{ best: 0 }}
      />,
    );
    // Component renders the count span only when `count > 0`, so the count
    // text disappears entirely once the polling response zeroes out.
    expect(screen.getByTitle("best").textContent).not.toMatch(/\d/);
  });

  it("preserves displayed count when re-rendered with same prop reference (no thrash)", () => {
    const stableCounts = { best: 7 };
    const { rerender } = render(
      <ReactionButtons
        setlistItemId="1"
        songId="100"
        eventId="42"
        initialCounts={stableCounts}
      />,
    );
    expect(screen.getByTitle("best").textContent).toContain("7");

    // Re-render with the same object reference — guard should bail out and
    // leave local state intact. (If we'd written `useState(initialCounts)`
    // and copied via useEffect, this would also hold; the guard's value is
    // visible in the prev test where the reference DOES change.)
    rerender(
      <ReactionButtons
        setlistItemId="1"
        songId="100"
        eventId="42"
        initialCounts={stableCounts}
      />,
    );
    expect(screen.getByTitle("best").textContent).toContain("7");
  });

  it("renders the three visual states correctly (zero+unselected dashed, hasCount+unselected solid gray, mine blue)", () => {
    // Zero count, not mine → dashed border, white bg, opacity 0.4
    const { rerender } = render(
      <ReactionButtons
        setlistItemId="1"
        songId="100"
        eventId="42"
        initialCounts={{ best: 0 }}
      />,
    );
    let fireButton = screen.getByTitle("best");
    expect(fireButton.style.border).toContain("dashed");
    expect(fireButton.style.background).toBe("white");
    expect(Number(fireButton.style.opacity)).toBeLessThan(1);

    // Has count, not mine → solid gray border, white bg, opacity 1
    rerender(
      <ReactionButtons
        setlistItemId="1"
        songId="100"
        eventId="42"
        initialCounts={{ best: 3 }}
      />,
    );
    fireButton = screen.getByTitle("best");
    expect(fireButton.style.border).toContain("solid");
    expect(fireButton.style.border).not.toContain("dashed");
    expect(fireButton.style.background).toBe("white");
    expect(Number(fireButton.style.opacity)).toBe(1);
  });

  it("flips visual state to 'mine' immediately on tap, before the POST resolves (optimistic)", async () => {
    // Mock fetch to NEVER resolve — we want to assert visual flip before the
    // network response. If the visual flip waited for the response, this
    // test would never see the active styling.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})) as unknown as typeof fetch,
    );

    render(
      <ReactionButtons
        setlistItemId="1"
        songId="100"
        eventId="42"
        initialCounts={{ best: 0 }}
      />,
    );

    const fireButton = screen.getByTitle("best");
    expect(fireButton.style.background).toBe("white");

    fireEvent.click(fireButton);

    await waitFor(() => {
      // After click, the optimistic update flips border to active color +
      // bg to active bg + count to 1, all before the POST has resolved.
      expect(fireButton.style.background).toContain(ACTIVE_BG_RGB);
      expect(fireButton.style.border).toContain(ACTIVE_COLOR_RGB);
      expect(fireButton.textContent).toContain("1");
    });
  });

  it("rolls back the optimistic update when POST fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      }) as unknown as typeof fetch,
    );

    render(
      <ReactionButtons
        setlistItemId="1"
        songId="100"
        eventId="42"
        initialCounts={{ best: 2 }}
      />,
    );

    const fireButton = screen.getByTitle("best");
    expect(fireButton.textContent).toContain("2");
    expect(fireButton.style.background).toBe("white");

    await act(async () => {
      fireEvent.click(fireButton);
    });

    // Network failed — visual state should revert: bg back to white, count
    // back to 2, no blue border.
    await waitFor(() => {
      expect(fireButton.textContent).toContain("2");
      expect(fireButton.style.background).toBe("white");
    });
    expect(fireButton.style.border).not.toContain(ACTIVE_COLOR_RGB);
  });

  it("rolls back the optimistic update when POST returns a malformed response (missing reactionId)", async () => {
    // Server returns 200 OK but a payload without `reactionId` — could happen
    // via deploy desync, proxy injection, or schema regression. Without the
    // runtime guard, the optimistic state would be written with reactionId =
    // undefined and setCounts would receive undefined.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ counts: { best: 1 } }), // no reactionId
      }) as unknown as typeof fetch,
    );

    render(
      <ReactionButtons
        setlistItemId="1"
        songId="100"
        eventId="42"
        initialCounts={{ best: 0 }}
      />,
    );
    const fireButton = screen.getByTitle("best");

    await act(async () => {
      fireEvent.click(fireButton);
    });

    // Visual state should revert: count back to 0 (no digit text), bg
    // back to white. Asserting both — bg-only would miss a regression
    // where the optimistic +1 count survives the rollback.
    await waitFor(() => {
      expect(fireButton.style.background).toBe("white");
      expect(fireButton.textContent).not.toMatch(/\d/);
    });
    // localStorage must NOT contain the OPTIMISTIC_PENDING sentinel.
    expect(localStorage.getItem("reactions-1")).toBeNull();
  });

  it("rolls back when POST returns an empty-string reactionId", async () => {
    // Server returns reactionId: "" — passes a naive `typeof === "string"`
    // check but `!!myReactions[type]` would be false, silently clearing
    // the active state and writing a bogus empty ID to localStorage.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ reactionId: "", counts: { best: 1 } }),
      }) as unknown as typeof fetch,
    );

    render(
      <ReactionButtons
        setlistItemId="1"
        songId="100"
        eventId="42"
        initialCounts={{ best: 0 }}
      />,
    );
    const fireButton = screen.getByTitle("best");

    await act(async () => {
      fireEvent.click(fireButton);
    });

    await waitFor(() => {
      expect(fireButton.style.background).toBe("white");
      expect(fireButton.textContent).not.toMatch(/\d/);
    });
    expect(localStorage.getItem("reactions-1")).toBeNull();
  });

  it("rolls back when POST returns counts with a non-numeric value", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          reactionId: "uuid-here",
          counts: { best: "1" }, // string instead of number
        }),
      }) as unknown as typeof fetch,
    );

    render(
      <ReactionButtons
        setlistItemId="1"
        songId="100"
        eventId="42"
        initialCounts={{ best: 2 }}
      />,
    );
    const fireButton = screen.getByTitle("best");

    await act(async () => {
      fireEvent.click(fireButton);
    });

    // Original count should be restored (no string contamination).
    await waitFor(() => {
      expect(fireButton.textContent).toContain("2");
    });
    expect(localStorage.getItem("reactions-1")).toBeNull();
  });

  it("on successful POST, replaces optimistic 'pending' with the server-returned reactionId in localStorage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          reactionId: "real-reaction-uuid",
          counts: { best: 1 },
        }),
      }) as unknown as typeof fetch,
    );

    render(
      <ReactionButtons
        setlistItemId="1"
        songId="100"
        eventId="42"
        initialCounts={{ best: 0 }}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTitle("best"));
    });

    await waitFor(() => {
      const persisted = JSON.parse(
        localStorage.getItem("reactions-1") ?? "{}",
      );
      // The sentinel 'pending' must never be persisted — the post-confirm
      // write replaces it with the real server reactionId.
      expect(persisted.best).toBe("real-reaction-uuid");
    });
  });

  it("does not clobber optimistic counts when polling delivers a fresh initialCounts mid-flight", async () => {
    // Hang the fetch so the mutation stays in flight for the whole test.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})) as unknown as typeof fetch,
    );

    const { rerender } = render(
      <ReactionButtons
        setlistItemId="1"
        songId="100"
        eventId="42"
        initialCounts={{ best: 0 }}
      />,
    );

    const fireButton = screen.getByTitle("best");

    // Tap → optimistic count goes 0 → 1.
    fireEvent.click(fireButton);
    await waitFor(() => {
      expect(fireButton.textContent).toContain("1");
    });

    // Polling tick fires mid-roundtrip with a brand-new map. Without the
    // in-flight gate, the prev-prop guard would call setCounts({best:0})
    // and erase the optimistic +1 — then on success/failure the snapshot
    // restore would target a stale counts value.
    rerender(
      <ReactionButtons
        setlistItemId="1"
        songId="100"
        eventId="42"
        initialCounts={{ best: 0 }}
      />,
    );

    expect(fireButton.textContent).toContain("1");
  });

  it("applies the polling update stashed during in-flight mutation once loading clears (rollback path)", async () => {
    // Reaction-server returns 500 → mutation rolls back to snapshot.
    // Without the pending-stash fix, a polling tick that arrived
    // mid-flight is recorded only in `prevInitialCounts` (not in
    // `counts`), and once `loading` clears, the rollback restores
    // the *click-time* snapshot — losing whatever the polling update
    // captured (e.g., a concurrent reaction by another viewer).
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      }) as unknown as typeof fetch,
    );

    const { rerender } = render(
      <ReactionButtons
        setlistItemId="1"
        songId="100"
        eventId="42"
        initialCounts={{ best: 2 }}
      />,
    );

    const fireButton = screen.getByTitle("best");
    expect(fireButton.textContent).toContain("2");

    // Tap → optimistic increment to 3 + loading=best in flight.
    fireEvent.click(fireButton);
    expect(fireButton.textContent).toContain("3");

    // Mid-flight polling tick: another viewer reacted, server now
    // says count=7. Pre-fix: dropped (only prevInitialCounts moves).
    // Post-fix: stashed in pendingPollCounts.
    rerender(
      <ReactionButtons
        setlistItemId="1"
        songId="100"
        eventId="42"
        initialCounts={{ best: 7 }}
      />,
    );
    // While loading is still active the stash hasn't been drained
    // yet; the optimistic +1 still wins on screen.
    expect(fireButton.textContent).toContain("3");

    // Mutation rolls back. The prev-loading transition block drains
    // the stash → counts = 7 (the polled snapshot), NOT 2 (the
    // pre-click snapshot).
    await waitFor(() => {
      expect(fireButton.textContent).toContain("7");
    });
  });

  it("does not let a stale stash overwrite fresh initialCounts when both transitions land in the same render (rollback path)", async () => {
    // Edge case from the same-render-cycle ordering hazard: if
    // `loading` transitions to null AND a fresh `initialCounts`
    // reference arrives in the SAME render, both prev-state blocks
    // fire. React applies the last setter call, so without the
    // explicit `setPendingPollCounts(null)` in the loading===null
    // branch of block 1, the stale stash from block 2 would
    // overwrite the fresh polling data block 1 just applied.
    //
    // Rollback path triggers this because the success path clears
    // the stash inline; failure path leaves the stash to be drained
    // by prev-loading.
    let resolveFetch!: (value: unknown) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise((resolve) => {
        resolveFetch = resolve;
      })) as unknown as typeof fetch,
    );

    const { rerender } = render(
      <ReactionButtons
        setlistItemId="1"
        songId="100"
        eventId="42"
        initialCounts={{ best: 2 }}
      />,
    );

    const fireButton = screen.getByTitle("best");

    // Tap → optimistic +1 + loading=best.
    fireEvent.click(fireButton);
    await waitFor(() => {
      expect(fireButton.textContent).toContain("3");
    });

    // Polling tick during in-flight stashes {best:7}.
    rerender(
      <ReactionButtons
        setlistItemId="1"
        songId="100"
        eventId="42"
        initialCounts={{ best: 7 }}
      />,
    );

    // Resolve the mutation FAILURE AND deliver a fresher polling
    // tick (10) close together. The rollback path leaves the stash
    // intact ({best:7}); when `loading` clears, the prev-loading
    // block tries to drain. If prev-prop ALSO fires in the same
    // render with {best:10}, block 1's loading===null branch
    // applies the fresh 10 — but without the explicit
    // setPendingPollCounts(null), block 2 still sees the stale
    // {best:7} stash and overwrites it. With the fix, block 1
    // clears the stash so block 2 is a no-op.
    resolveFetch({ ok: false, status: 500 });
    rerender(
      <ReactionButtons
        setlistItemId="1"
        songId="100"
        eventId="42"
        initialCounts={{ best: 10 }}
      />,
    );

    // Final value should be 10 (latest polling), not 7 (stale stash)
    // and not 2 (the rollback snapshot).
    await waitFor(() => {
      expect(fireButton.textContent).toContain("10");
    });
    expect(fireButton.textContent).not.toContain("7");
  });

  it("discards the polling stash on POST success (server count is authoritative)", async () => {
    // POST resolves with `counts: {best: 3}` — server is the
    // authoritative state for this setlist item. A polled value
    // captured during the in-flight window must NOT overwrite the
    // server response on the prev-loading transition.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          reactionId: "real-reaction-uuid",
          counts: { best: 3 },
        }),
      }) as unknown as typeof fetch,
    );

    const { rerender } = render(
      <ReactionButtons
        setlistItemId="1"
        songId="100"
        eventId="42"
        initialCounts={{ best: 2 }}
      />,
    );

    const fireButton = screen.getByTitle("best");

    fireEvent.click(fireButton);

    // Mid-flight polling tick says best=99 (would-be stale). Should
    // be stashed but discarded by the POST success path.
    rerender(
      <ReactionButtons
        setlistItemId="1"
        songId="100"
        eventId="42"
        initialCounts={{ best: 99 }}
      />,
    );

    await waitFor(() => {
      // Final value is 3 (server-returned), not 99 (polled stash).
      expect(fireButton.textContent).toContain("3");
    });
    expect(fireButton.textContent).not.toContain("99");
  });

  it("exposes toggle state to assistive tech via aria-pressed and aria-label", () => {
    const { rerender } = render(
      <ReactionButtons
        setlistItemId="1"
        songId="100"
        eventId="42"
        initialCounts={{ best: 0 }}
      />,
    );
    const fireButton = screen.getByTitle("best");
    expect(fireButton.getAttribute("aria-pressed")).toBe("false");
    expect(fireButton.getAttribute("aria-label")).toBe("best");

    // Pre-seed localStorage so myReactions is hydrated as active for "best".
    localStorage.setItem(
      "reactions-2",
      JSON.stringify({ best: "existing-id" }),
    );
    rerender(
      <ReactionButtons
        setlistItemId="2"
        songId="100"
        eventId="42"
        initialCounts={{ best: 1 }}
      />,
    );
    const fireButton2 = screen.getByTitle("best");
    expect(fireButton2.getAttribute("aria-pressed")).toBe("true");
  });
});
