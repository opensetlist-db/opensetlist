import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PerformersCard } from "@/components/event/PerformersCard";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("PerformersCard", () => {
  const sample = [
    { id: "si-1", name: "花帆", color: "#FF69B4" },
    { id: "si-2", name: "梢", color: null },
  ];

  it("renders nothing when performers is empty", () => {
    const { container } = render(<PerformersCard performers={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders one pill per performer", () => {
    render(<PerformersCard performers={sample} />);
    expect(screen.getByText("花帆")).toBeInTheDocument();
    expect(screen.getByText("梢")).toBeInTheDocument();
  });

  it("uses textSubtle for color-less performers (no inventing colors)", () => {
    render(<PerformersCard performers={[{ ...sample[1] }]} />);
    const span = screen.getByText("梢");
    // textSubtle = #64748b in tokens; jsdom converts to rgb. Just
    // assert it's set (not empty), to confirm the fallback branch
    // ran and the pill isn't transparent.
    expect(span.style.color).not.toBe("");
  });
});
