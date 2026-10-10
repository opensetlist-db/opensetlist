import { describe, it, expect } from "vitest";
import { mergePolledImpressions } from "@/lib/impressionsMerge";
import type { Impression } from "@/lib/types/impression";

// Polling is the only path on which a viewer learns about other users'
// edits / hides / deletes since n14, so the polled-page merge has to
// collapse edited chains and prune rows that left the page window.

function row(
  id: string,
  createdAt: string,
  rootImpressionId = id,
  content = id,
): Impression {
  return {
    id,
    rootImpressionId,
    eventId: "1",
    content,
    locale: "ko",
    createdAt,
  } as Impression;
}

const T = (m: number) => `2026-11-14T08:${String(m).padStart(2, "0")}:00.000Z`;

describe("mergePolledImpressions", () => {
  it("adds new rows and dedupes by id, newest first", () => {
    const prev = [row("b", T(2)), row("a", T(1))];
    const polled = [row("c", T(3)), row("b", T(2)), row("a", T(1))];
    const out = mergePolledImpressions(prev, polled, "cursor");
    expect(out.map((r) => r.id)).toEqual(["c", "b", "a"]);
  });

  it("collapses an edit by another user to the newest version of the chain", () => {
    const prev = [row("v1", T(1), "chain", "old text"), row("x", T(0))];
    const polled = [row("v2", T(5), "chain", "new text"), row("x", T(0))];
    const out = mergePolledImpressions(prev, polled, null);
    expect(out.map((r) => r.id)).toEqual(["v2", "x"]);
    expect(out[0].content).toBe("new text");
  });

  it("a stale page cannot reinstate an older version of a chain the viewer just edited", () => {
    // Viewer edited: v2 merged from the POST response. The next poll hits
    // the 5 s server cache and still carries v1.
    const prev = [row("v2", T(9), "chain", "new"), row("x", T(0))];
    const polled = [row("v1", T(1), "chain", "old"), row("x", T(0))];
    const out = mergePolledImpressions(prev, polled, null);
    expect(out.map((r) => r.id)).toEqual(["v2", "x"]);
  });

  it("prunes a row hidden or deleted by another user when it falls inside the polled window", () => {
    const prev = [row("c", T(3)), row("b", T(2)), row("a", T(1))];
    const polled = [row("c", T(3)), row("a", T(1))]; // b vanished
    const out = mergePolledImpressions(prev, polled, "cursor");
    expect(out.map((r) => r.id)).toEqual(["c", "a"]);
  });

  it("keeps rows older than the window (loaded via 'see older') when a cursor is present", () => {
    const prev = [row("c", T(3)), row("old", T(0))];
    const polled = [row("c", T(3)), row("b", T(2))];
    const out = mergePolledImpressions(prev, polled, "cursor");
    expect(out.map((r) => r.id)).toEqual(["c", "b", "old"]);
  });

  it("prunes rows older than the window when the page is the whole archive", () => {
    const prev = [row("c", T(3)), row("gone", T(0))];
    const polled = [row("c", T(3)), row("b", T(2))];
    const out = mergePolledImpressions(prev, polled, null);
    expect(out.map((r) => r.id)).toEqual(["c", "b"]);
  });

  it("keeps the viewer's own fresh submit that a cached page does not show yet", () => {
    const prev = [row("mine", T(9)), row("b", T(2))];
    const polled = [row("b", T(2)), row("a", T(1))];
    const out = mergePolledImpressions(prev, polled, null);
    expect(out.map((r) => r.id)).toEqual(["mine", "b", "a"]);
  });

  it("leaves the list alone on an empty page", () => {
    const prev = [row("b", T(2))];
    expect(mergePolledImpressions(prev, [], null)).toBe(prev);
  });

  it("is idempotent", () => {
    const prev = [row("v1", T(1), "chain"), row("b", T(2)), row("old", T(0))];
    const polled = [row("v2", T(5), "chain"), row("b", T(2))];
    const once = mergePolledImpressions(prev, polled, "cursor");
    const twice = mergePolledImpressions(once, polled, "cursor");
    expect(twice).toEqual(once);
  });
});
