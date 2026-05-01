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
    topReaction: { type: "best", emoji: "🔥", count: 6 },
  },
  {
    setlistItemId: "2",
    mainTitle: "Second Song",
    subTitle: null,
    variantLabel: null,
    totalReactions: 8,
    topReaction: { type: "moved", emoji: "🩷", count: 5 },
  },
  {
    setlistItemId: "3",
    mainTitle: "Third Song",
    subTitle: null,
    variantLabel: null,
    totalReactions: 5,
    topReaction: { type: "surprise", emoji: "😱", count: 3 },
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

  it("renders each song with title, medal, and top-reaction count", () => {
    render(<TrendingSongs songs={sample} />);
    expect(screen.getByText("First Song")).toBeInTheDocument();
    expect(screen.getByText("Second Song")).toBeInTheDocument();
    expect(screen.getByText("Third Song")).toBeInTheDocument();
    expect(screen.getByText("🥇")).toBeInTheDocument();
    expect(screen.getByText("🥈")).toBeInTheDocument();
    expect(screen.getByText("🥉")).toBeInTheDocument();
    // Top-reaction emoji + count render in separate spans (the
    // emoji at 14px, the count at 12px) per the mockup's two-line
    // item layout — query each independently rather than as a
    // single concatenated string.
    expect(screen.getByText("🔥")).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();
    expect(screen.getByText("🩷")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("😱")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
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
        topReaction: { type: "best", emoji: "🔥", count: 3 },
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
        topReaction: { type: "best", emoji: "🔥", count: 3 },
      },
    ];
    render(<TrendingSongs songs={songs} />);
    expect(screen.getByText("Dream Believers")).toBeInTheDocument();
    expect(screen.getByText("(SAKURA Ver.)")).toBeInTheDocument();
  });

  it("hides medal emojis from assistive tech (decorative)", () => {
    const { container } = render(<TrendingSongs songs={sample} />);
    const medals = Array.from(
      container.querySelectorAll("span[aria-hidden='true']"),
    );
    // Exactly three medals (🥇 🥈 🥉) marked aria-hidden so screen readers
    // don't announce them. Pinning the exact count catches regressions
    // where an extra decorative span sneaks in.
    expect(medals).toHaveLength(3);
  });
});
