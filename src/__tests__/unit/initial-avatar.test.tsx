import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { InitialAvatar } from "@/components/InitialAvatar";
import { colors } from "@/styles/tokens";
import { hexToRgbString } from "@/__tests__/utils/color";

function getAvatarEl(container: HTMLElement): HTMLElement {
  const el = container.firstElementChild as HTMLElement | null;
  if (!el) throw new Error("InitialAvatar produced no DOM");
  return el;
}

describe("<InitialAvatar />", () => {
  it("renders the first character of the label", () => {
    const { container } = render(
      <InitialAvatar label="Hinoshita Kaho" color="#FF6B9D" />,
    );
    expect(getAvatarEl(container).textContent).toBe("H");
  });

  it("falls back to '?' when label is empty", () => {
    const { container } = render(
      <InitialAvatar label="" color="#FF6B9D" />,
    );
    expect(getAvatarEl(container).textContent).toBe("?");
  });

  it("uses the supplied color for the gradient + text", () => {
    const { container } = render(
      <InitialAvatar label="K" color="#0277BD" />,
    );
    const el = getAvatarEl(container);
    // Two-stop gradient using the source color at two alpha levels;
    // jsdom converts each `#0277BD40` / `#0277BD80` into rgba().
    expect(el.style.background).toContain("linear-gradient(135deg");
    // Text color is the source color (full opacity).
    expect(el.style.color).toBe(hexToRgbString("#0277BD"));
  });

  it("falls back to textMuted when color is null/undefined", () => {
    const { container } = render(<InitialAvatar label="X" color={null} />);
    expect(getAvatarEl(container).style.color).toBe(
      hexToRgbString(colors.textMuted),
    );
  });

  it("respects the size prop", () => {
    const { container } = render(
      <InitialAvatar label="A" color="#888888" size={48} />,
    );
    const el = getAvatarEl(container);
    expect(el.style.width).toBe("48px");
    expect(el.style.height).toBe("48px");
    // Math.round(48 * 0.4) = 19
    expect(el.style.fontSize).toBe("19px");
  });

  it("is round (50% borderRadius)", () => {
    const { container } = render(<InitialAvatar label="X" color={null} />);
    expect(getAvatarEl(container).style.borderRadius).toBe("50%");
  });
});
