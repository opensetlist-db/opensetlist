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

  it("renders each song with title, medal, all four reaction counts, and aggregate total", () => {
    // F17 fix: previously the widget rendered only the single
    // highest-emotion count under each ranked item. Day-1 surfaced
    // that this under-displayed total engagement once per-type counts
    // grew past rehearsal-scale single digits. The card now mirrors
    // `<ReactionButtons>`'s per-row strip — all four counts in
    // canonical REACTION_TYPES order — plus an `= N` total that names
    // the ranking criterion (the card is "TOP 3 by total reactions").
    render(<TrendingSongs songs={sample} />);
    // Titles
    expect(screen.getByText("First Song")).toBeInTheDocument();
    expect(screen.getByText("Second Song")).toBeInTheDocument();
    expect(screen.getByText("Third Song")).toBeInTheDocument();
    // Medals — one per ranked slot
    expect(screen.getByText("🥇")).toBeInTheDocument();
    expect(screen.getByText("🥈")).toBeInTheDocument();
    expect(screen.getByText("🥉")).toBeInTheDocument();
    // Every reaction emoji renders once per ranked song (regardless
    // of whether that song has any of that reaction). Pinning the
    // count to 3 catches the F17-style regression where the widget
    // collapses back to a single per-song emoji.
    for (const emoji of ["😭", "🔥", "😱", "🩷"]) {
      expect(screen.getAllByText(emoji)).toHaveLength(3);
    }
    // Aggregate totals — `= N` is i18n-neutral math notation, no
    // translation key needed.
    expect(screen.getByText("= 10")).toBeInTheDocument();
    expect(screen.getByText("= 8")).toBeInTheDocument();
    expect(screen.getByText("= 5")).toBeInTheDocument();
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
    // Medals and reaction emojis are decorative — the count digits and
    // song title carry the meaning, so screen readers shouldn't announce
    // the emoji glyphs. Verify each medal's wrapping span has
    // aria-hidden, and that every reaction emoji rendered in the strip
    // (3 songs × 4 reactions = 12) is also aria-hidden.
    for (const medal of ["🥇", "🥈", "🥉"]) {
      expect(screen.getByText(medal)).toHaveAttribute("aria-hidden", "true");
    }
    for (const emoji of ["😭", "🔥", "😱", "🩷"]) {
      const els = screen.getAllByText(emoji);
      expect(els).toHaveLength(3);
      for (const el of els) {
        expect(el).toHaveAttribute("aria-hidden", "true");
      }
    }
  });

  it("exposes each reaction strip item as a labelled image with type + count", () => {
    // CR follow-up: the visible strip is emoji + bare digit, both
    // aria-hidden. Without an outer accessible label, screen readers
    // would announce nothing meaningful for the trending counts. Each
    // wrapper carries `role="img"` + `aria-label="<type> <count>"` so
    // AT users hear "best 6", "waiting 2", etc. in REACTION_TYPES
    // canonical order. The mock for `useTranslations` (`(key) => key`)
    // makes `t(type)` return the raw type name, so the expected
    // accessible names are "<type> <count>".
    render(<TrendingSongs songs={sample} />);
    // Song 1 — full distribution across all four types.
    expect(screen.getByLabelText("waiting 2")).toBeInTheDocument();
    expect(screen.getByLabelText("best 6")).toBeInTheDocument();
    expect(screen.getByLabelText("surprise 1")).toBeInTheDocument();
    expect(screen.getByLabelText("moved 1")).toBeInTheDocument();
    // Song 2 (best:3, moved:5; waiting + surprise absent)
    expect(screen.getByLabelText("best 3")).toBeInTheDocument();
    expect(screen.getByLabelText("moved 5")).toBeInTheDocument();
    expect(screen.getByLabelText("surprise 0")).toBeInTheDocument();
    // Song 3 (best:2, surprise:3; waiting + moved absent)
    expect(screen.getByLabelText("best 2")).toBeInTheDocument();
    expect(screen.getByLabelText("surprise 3")).toBeInTheDocument();
    expect(screen.getByLabelText("moved 0")).toBeInTheDocument();
    // "waiting 0" appears in BOTH song 2 and song 3 (waiting absent
    // from each), proving that absent types render with a 0-count
    // accessible label across multiple ranked items — the strip
    // reads consistently regardless of which types are populated.
    expect(screen.getAllByLabelText("waiting 0")).toHaveLength(2);
    // The aggregate `= N` is sighted-only sugar — the four per-type
    // labels already carry the full information, and the visible
    // total just names the ranking criterion. Verify it is indeed
    // hidden from AT (no labelled image / role for it).
    expect(screen.getByText("= 10")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("= 8")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("= 5")).toHaveAttribute("aria-hidden", "true");
  });
});
