import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import ArtistAvatar from "@/components/ArtistAvatar";
import { colors, radius } from "@/styles/tokens";
import { hexToRgbString } from "@/__tests__/utils/color";

function getAvatarEl(container: HTMLElement): HTMLElement {
  // The avatar is the only top-level element rendered by the component.
  const el = container.firstElementChild as HTMLElement | null;
  if (!el) throw new Error("ArtistAvatar produced no DOM");
  return el;
}

describe("<ArtistAvatar />", () => {
  describe("color fallback chain", () => {
    it("renders the explicit color as solid background", () => {
      const { container } = render(
        <ArtistAvatar artist={{ color: "#0277BD", shortName: "Hasu" }} />,
      );
      const el = getAvatarEl(container);
      expect(el.style.background).toBe(hexToRgbString("#0277BD"));
    });

    it("renders the brand gradient when color is null", () => {
      const { container } = render(
        <ArtistAvatar artist={{ color: null, shortName: "Gaku" }} />,
      );
      const el = getAvatarEl(container);
      // jsdom converts each hex inside `linear-gradient(...)` to its
      // rgb() form, so assert against the converted equivalent rather
      // than the raw token string.
      expect(el.style.background).toBe(
        `linear-gradient(135deg, ${hexToRgbString("#4FC3F7")}, ${hexToRgbString("#0277BD")})`,
      );
    });

    it("renders the brand gradient when color is undefined / absent", () => {
      const { container } = render(<ArtistAvatar artist={{}} />);
      const el = getAvatarEl(container);
      expect(el.style.background).toBe(
        `linear-gradient(135deg, ${hexToRgbString("#4FC3F7")}, ${hexToRgbString("#0277BD")})`,
      );
    });
  });

  describe("label fallback chain", () => {
    it("uses shortName[0] when shortName is set", () => {
      const { container } = render(
        <ArtistAvatar artist={{ shortName: "Hasu", name: "Hasunosora" }} />,
      );
      expect(getAvatarEl(container).textContent).toBe("H");
    });

    it("falls back to name[0] when shortName is missing", () => {
      const { container } = render(
        <ArtistAvatar artist={{ name: "Niji" }} />,
      );
      expect(getAvatarEl(container).textContent).toBe("N");
    });

    it("falls back to '?' when both are missing", () => {
      const { container } = render(<ArtistAvatar artist={{}} />);
      expect(getAvatarEl(container).textContent).toBe("?");
    });

    it("handles empty-string names by falling back to '?'", () => {
      // .charAt(0) on "" returns "" — the ` || "?"` final fallback covers it.
      const { container } = render(
        <ArtistAvatar artist={{ shortName: "", name: "" }} />,
      );
      expect(getAvatarEl(container).textContent).toBe("?");
    });
  });

  describe("sizing", () => {
    it("defaults to 48×48 with proportional font size", () => {
      const { container } = render(<ArtistAvatar artist={{}} />);
      const el = getAvatarEl(container);
      expect(el.style.width).toBe("48px");
      expect(el.style.height).toBe("48px");
      // Math.round(48 * 0.35) = 17
      expect(el.style.fontSize).toBe("17px");
    });

    it("respects size prop (40 desktop)", () => {
      const { container } = render(<ArtistAvatar artist={{}} size={40} />);
      const el = getAvatarEl(container);
      expect(el.style.width).toBe("40px");
      expect(el.style.height).toBe("40px");
      // Math.round(40 * 0.35) = 14
      expect(el.style.fontSize).toBe("14px");
    });

    it("uses radius.avatar from tokens", () => {
      const { container } = render(<ArtistAvatar artist={{}} />);
      expect(getAvatarEl(container).style.borderRadius).toBe(
        `${radius.avatar}px`,
      );
    });
  });
});
