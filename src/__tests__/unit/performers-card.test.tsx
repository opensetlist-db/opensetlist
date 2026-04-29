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
});
