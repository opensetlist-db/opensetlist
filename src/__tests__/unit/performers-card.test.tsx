import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PerformersCard } from "@/components/event/PerformersCard";
import { hexToRgbString } from "@/__tests__/utils/color";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("PerformersCard", () => {
  // `color` is now always a non-null string — caller resolves the
  // primary unit's color via `resolveUnitColor` (which substitutes
  // a deterministic palette pick keyed on the slug when
  // `Artist.color` is null) before passing the prop.
  const sample = [
    { id: "si-1", name: "花帆", color: "#e91e8c" },
    { id: "si-2", name: "梢", color: "#7B1FA2" }, // resolved-palette example
  ];

  it("renders nothing when performers is empty", () => {
    const { container } = render(<PerformersCard performers={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders one pill per performer with the supplied color", () => {
    render(<PerformersCard performers={sample} />);
    const hanaho = screen.getByText("花帆");
    expect(hanaho.style.color).toBe(hexToRgbString("#e91e8c"));

    const kozue = screen.getByText("梢");
    expect(kozue.style.color).toBe(hexToRgbString("#7B1FA2"));
  });

  it("appends the guest suffix on guest pills (D9)", () => {
    // Guest pill carries a muted "· {guestLabel}" suffix. Mocked
    // useTranslations returns the i18n key verbatim, so the suffix
    // text reads "· guestLabel" here.
    const withGuest = [
      { id: "si-1", name: "花帆", color: "#e91e8c" },
      {
        id: "si-9",
        name: "ゲスト太郎",
        color: "#3949AB",
        isGuest: true,
      },
    ];
    render(<PerformersCard performers={withGuest} />);
    expect(screen.getByText(/·\s*guestLabel/)).toBeInTheDocument();
    // Host pill has no suffix.
    expect(screen.getByText("花帆")).toBeInTheDocument();
  });

  it("renders the host/guest divider when both groups are non-empty", () => {
    // The divider is a flex-basis:100% <li> with a top border. We
    // can't query by text, but we can count <li> children: 2 hosts
    // + 1 divider + 1 guest = 4 list items.
    const mixed = [
      { id: "si-1", name: "花帆", color: "#e91e8c" },
      { id: "si-2", name: "梢", color: "#7B1FA2" },
      { id: "si-9", name: "ゲスト太郎", color: "#3949AB", isGuest: true },
    ];
    const { container } = render(<PerformersCard performers={mixed} />);
    const items = container.querySelectorAll("li");
    expect(items.length).toBe(4); // 2 hosts + 1 divider + 1 guest
  });

  it("does not render the divider when there are no guests", () => {
    const hostsOnly = [
      { id: "si-1", name: "花帆", color: "#e91e8c" },
      { id: "si-2", name: "梢", color: "#7B1FA2" },
    ];
    const { container } = render(<PerformersCard performers={hostsOnly} />);
    const items = container.querySelectorAll("li");
    expect(items.length).toBe(2); // 2 hosts, no divider, no guests
  });

  it("does not render the divider when there are no hosts (guests only)", () => {
    const guestsOnly = [
      { id: "si-9", name: "ゲスト太郎", color: "#3949AB", isGuest: true },
    ];
    const { container } = render(<PerformersCard performers={guestsOnly} />);
    const items = container.querySelectorAll("li");
    expect(items.length).toBe(1); // 1 guest, no divider
  });
});
