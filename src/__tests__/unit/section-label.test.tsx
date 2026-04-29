import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { SectionLabel } from "@/components/SectionLabel";

describe("<SectionLabel />", () => {
  it("renders the children inside an h2 by default", () => {
    const { container } = render(<SectionLabel>SUBUNITS</SectionLabel>);
    const el = container.firstElementChild as HTMLElement | null;
    expect(el?.tagName).toBe("H2");
    expect(el?.textContent).toBe("SUBUNITS");
  });

  it("respects the `as` prop for nested heading hierarchy", () => {
    const { container } = render(
      <SectionLabel as="h3">MEMBERS</SectionLabel>,
    );
    expect(container.firstElementChild?.tagName).toBe("H3");
  });

  it("applies the uppercase + letter-spacing visual treatment", () => {
    const { container } = render(<SectionLabel>recent</SectionLabel>);
    const el = container.firstElementChild as HTMLElement;
    // The label is a visual-uppercase via CSS, not a string transform —
    // assert the property rather than the rendered text so a future
    // a11y change keeping the source casing intact is fine.
    expect(el.style.textTransform).toBe("uppercase");
    expect(el.style.letterSpacing).toBe("0.06em");
    expect(el.style.fontWeight).toBe("700");
  });
});
