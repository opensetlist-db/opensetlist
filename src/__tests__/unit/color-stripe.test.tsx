import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ColorStripe } from "@/components/ColorStripe";
import { BRAND_GRADIENT } from "@/lib/artistColor";
import { hexToRgbString } from "@/__tests__/utils/color";

function getStripeEl(container: HTMLElement): HTMLElement {
  const el = container.firstElementChild as HTMLElement | null;
  if (!el) throw new Error("ColorStripe produced no DOM");
  return el;
}

// jsdom converts hex stops inside `linear-gradient(...)` to rgb()
// form. Build the expected gradient string from BRAND_GRADIENT so a
// future palette change updates the expectation automatically (same
// pattern as artist-avatar.test.tsx).
const EXPECTED_GRADIENT_BG = (() => {
  const stops = BRAND_GRADIENT.match(/#[0-9a-fA-F]{6}/g);
  if (!stops) throw new Error("BRAND_GRADIENT has no hex stops");
  const direction = BRAND_GRADIENT.match(/^linear-gradient\(([^,]+),/)?.[1];
  if (!direction) throw new Error("BRAND_GRADIENT missing direction");
  return `linear-gradient(${direction}, ${stops.map(hexToRgbString).join(", ")})`;
})();

describe("<ColorStripe />", () => {
  it("renders a 5px tall stripe", () => {
    const { container } = render(<ColorStripe artist={null} />);
    expect(getStripeEl(container).style.height).toBe("5px");
  });

  it("uses the artist's color when set (solid stripe)", () => {
    const { container } = render(
      <ColorStripe artist={{ color: "#FF6B9D" }} />,
    );
    expect(getStripeEl(container).style.background).toBe(
      hexToRgbString("#FF6B9D"),
    );
  });

  it("falls back to the brand gradient when color is null", () => {
    const { container } = render(<ColorStripe artist={{ color: null }} />);
    expect(getStripeEl(container).style.background).toBe(EXPECTED_GRADIENT_BG);
  });

  it("falls back to the brand gradient when artist is null", () => {
    const { container } = render(<ColorStripe artist={null} />);
    expect(getStripeEl(container).style.background).toBe(EXPECTED_GRADIENT_BG);
  });
});
