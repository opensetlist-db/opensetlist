import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  TrendingSongs,
  type TrendingSong,
} from "@/components/TrendingSongs";
import { colors } from "@/styles/tokens";
import { hexToRgbString } from "@/__tests__/utils/color";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const sample: TrendingSong[] = [
  {
    setlistItemId: "1",
    mainTitle: "First Song",
    subTitle: null,
    variantLabel: null,
    totalReactions: 10,
    reactionCounts: { best: 6, waiting: 2, surprise: 1, moved: 1 },
  },
  {
    setlistItemId: "2",
    mainTitle: "Second Song",
    subTitle: null,
    variantLabel: null,
    totalReactions: 8,
    reactionCounts: { moved: 5, best: 3 },
  },
  {
    setlistItemId: "3",
    mainTitle: "Third Song",
    subTitle: null,
    variantLabel: null,
    totalReactions: 5,
    reactionCounts: { surprise: 3, best: 2 },
  },
];

describe("TrendingSongs", () => {
  it("renders the card with an empty-state nudge when songs is empty", () => {
    // Mockup `event-page-desktop-mockup-v2.jsx:626-629` keeps the
    // card visible with a "no reactions yet" line so the trending
    // section explains itself even before the first reaction lands.
    // Previously the card returned null on empty — that hid the
    // surface entirely.
    render(<TrendingSongs songs={[]} />);
    // The title still renders.
    expect(screen.getByText("trending")).toBeInTheDocument();
    // The empty-state copy renders via the `trendingEmpty` key.
    expect(screen.getByText("trendingEmpty")).toBeInTheDocument();
  });

  it("renders each song with title, medal, and per-type reaction counts (zeros omitted)", () => {
    // F17 fix: previously the widget rendered only the single
    // highest-emotion count under each ranked item. Day-1 surfaced
    // that this under-displayed total engagement once per-type counts
    // grew past rehearsal-scale single digits. The card now renders
    // the per-type counts in REACTION_TYPES canonical order, filtered
    // to only the types this song has — unused types are omitted to
    // keep the card compact.
    render(<TrendingSongs songs={sample} />);
    // Titles
    expect(screen.getByText("First Song")).toBeInTheDocument();
    expect(screen.getByText("Second Song")).toBeInTheDocument();
    expect(screen.getByText("Third Song")).toBeInTheDocument();
    // Medals — one per ranked slot
    expect(screen.getByText("🥇")).toBeInTheDocument();
    expect(screen.getByText("🥈")).toBeInTheDocument();
    expect(screen.getByText("🥉")).toBeInTheDocument();
    // Per-emoji render counts (matches the sample fixture):
    // 😭 (waiting): song 1 only           → 1
    // 🔥 (best):    songs 1 + 2 + 3       → 3
    // 😱 (surprise): songs 1 + 3          → 2
    // 🩷 (moved):   songs 1 + 2           → 2
    // Pinning these catches both the F17-style regression (collapse
    // back to a single per-song emoji) and any accidental re-introduction
    // of zero-count slots.
    expect(screen.getAllByText("😭")).toHaveLength(1);
    expect(screen.getAllByText("🔥")).toHaveLength(3);
    expect(screen.getAllByText("😱")).toHaveLength(2);
    expect(screen.getAllByText("🩷")).toHaveLength(2);
  });

  it("uses the trending tokens for background and border", () => {
    const { container } = render(<TrendingSongs songs={sample} />);
    const section = container.querySelector("section");
    expect(section?.style.background).toBe(hexToRgbString(colors.trendingBg));
    // Border color appears in computed `border` style
    expect(section?.style.border).toContain(
      hexToRgbString(colors.trendingBorder),
    );
  });

  it("uses responsive flex utilities so mobile stacks vertically and desktop lays out 3-across", () => {
    const { container } = render(<TrendingSongs songs={sample} />);
    const ul = container.querySelector("ul");
    // Tailwind class names live on the element regardless of viewport;
    // the actual layout switch is media-query driven. Asserting both
    // mobile (column flex with 9px gap) and desktop (row flex with
    // 32px / lg:gap-8 gap) classes are wired confirms the responsive
    // intent.
    expect(ul?.className).toContain("flex-col");
    expect(ul?.className).toContain("gap-y-[9px]");
    expect(ul?.className).toContain("lg:flex-row");
    expect(ul?.className).toContain("lg:gap-x-8");
  });

  it("renders the localized sub-title beside the original when both are provided", () => {
    // Mirrors `<SetlistRow>`'s SongTitleBlock — original (main) is the
    // primary slot, the localized title sits next to it as a muted
    // sub line. This is the cross-surface consistency contract.
    const songs: TrendingSong[] = [
      {
        setlistItemId: "1",
        mainTitle: "オリジナル",
        subTitle: "오리지널",
        variantLabel: null,
        totalReactions: 3,
        reactionCounts: { best: 3 },
      },
    ];
    render(<TrendingSongs songs={songs} />);
    expect(screen.getByText("オリジナル")).toBeInTheDocument();
    expect(screen.getByText("오리지널")).toBeInTheDocument();
  });

  it("renders the variantLabel in parentheses when present", () => {
    const songs: TrendingSong[] = [
      {
        setlistItemId: "1",
        mainTitle: "Dream Believers",
        subTitle: null,
        variantLabel: "SAKURA Ver.",
        totalReactions: 3,
        reactionCounts: { best: 3 },
      },
    ];
    render(<TrendingSongs songs={songs} />);
    expect(screen.getByText("Dream Believers")).toBeInTheDocument();
    expect(screen.getByText("(SAKURA Ver.)")).toBeInTheDocument();
  });

  it("hides medal and reaction emojis from assistive tech (decorative)", () => {
    render(<TrendingSongs songs={sample} />);
    // Medals and reaction emojis are decorative — the per-type aria-label
    // on each strip wrapper carries the meaning. Verify medals are
    // aria-hidden, and that every rendered reaction emoji (the strip
    // omits zero-count types, so per-emoji counts vary by fixture) is
    // also aria-hidden.
    for (const medal of ["🥇", "🥈", "🥉"]) {
      expect(screen.getByText(medal)).toHaveAttribute("aria-hidden", "true");
    }
    for (const emoji of ["😭", "🔥", "😱", "🩷"]) {
      for (const el of screen.queryAllByText(emoji)) {
        expect(el).toHaveAttribute("aria-hidden", "true");
      }
    }
  });

  it("exposes each reaction strip item as a labelled image with type + count", () => {
    // CR follow-up: the visible strip is emoji + bare digit, both
    // aria-hidden. Without an outer accessible label, screen readers
    // would announce nothing meaningful for the trending counts. Each
    // rendered wrapper carries `role="img"` + `aria-label="<type>
    // <count>"` so AT users hear "best 6", "waiting 2", etc. in
    // REACTION_TYPES canonical order. The mock for `useTranslations`
    // (`(key) => key`) makes `t(type)` return the raw type name, so
    // expected accessible names are "<type> <count>". Zero-count
    // types are omitted from the render entirely, so they have no
    // accessible label either — verified below.
    render(<TrendingSongs songs={sample} />);
    // Song 1 — full distribution across all four types.
    expect(screen.getByLabelText("waiting 2")).toBeInTheDocument();
    expect(screen.getByLabelText("best 6")).toBeInTheDocument();
    expect(screen.getByLabelText("surprise 1")).toBeInTheDocument();
    expect(screen.getByLabelText("moved 1")).toBeInTheDocument();
    // Song 2 (best:3, moved:5; waiting + surprise absent)
    expect(screen.getByLabelText("best 3")).toBeInTheDocument();
    expect(screen.getByLabelText("moved 5")).toBeInTheDocument();
    // Song 3 (best:2, surprise:3; waiting + moved absent)
    expect(screen.getByLabelText("best 2")).toBeInTheDocument();
    expect(screen.getByLabelText("surprise 3")).toBeInTheDocument();
    // Absent types must NOT produce a "<type> 0" label — the whole
    // wrapper is filtered out at the renderer. Pinning these guards
    // against a regression that re-introduces empty zero-count slots
    // (which would clutter both the visual strip and the AT readout).
    expect(screen.queryByLabelText(/ 0$/)).toBeNull();
  });
});
