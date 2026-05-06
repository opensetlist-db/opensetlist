import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NumberSlot } from "@/components/NumberSlot";

describe("NumberSlot", () => {
  it("confirmed: renders the position number as a span (no button)", () => {
    render(<NumberSlot state="confirmed" position={5} />);
    expect(screen.getByText("5")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("rumoured: renders a [?] button with dashed border", () => {
    render(<NumberSlot state="rumoured" position={3} rumouredLabel="rumoured-aria" />);
    const btn = screen.getByRole("button", { name: "rumoured-aria" });
    expect(btn.textContent).toBe("?");
    // Inline style carries the dashed border. jsdom returns the
    // shorthand `border` style with the parsed components.
    expect(btn.getAttribute("style")).toContain("dashed");
  });

  it("my-confirmed: renders a [✓] button with solid sky-blue border", () => {
    render(
      <NumberSlot
        state="my-confirmed"
        position={3}
        myConfirmedLabel="my-confirmed-aria"
      />,
    );
    const btn = screen.getByRole("button", { name: "my-confirmed-aria" });
    expect(btn.textContent).toBe("✓");
    expect(btn.getAttribute("style")).toContain("solid");
    // Background is colors.primaryBg (#e8f4fd → rgb(232, 244, 253)).
    expect(btn.getAttribute("style")?.toLowerCase()).toContain(
      "rgb(232, 244, 253)",
    );
  });

  it("rumoured / my-confirmed: clicking fires onTap", () => {
    const onTap = vi.fn();
    render(
      <NumberSlot
        state="rumoured"
        position={3}
        onTap={onTap}
        rumouredLabel="x"
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it("rumoured: missing onTap is safe (button still tappable, no error)", () => {
    render(<NumberSlot state="rumoured" position={3} rumouredLabel="x" />);
    // No-op tap — should not throw.
    expect(() => fireEvent.click(screen.getByRole("button"))).not.toThrow();
  });

  it("confirmed: position number is rendered (regression: byte-equiv with pre-refactor span)", () => {
    render(<NumberSlot state="confirmed" position={42} />);
    const span = screen.getByText("42");
    expect(span.tagName.toLowerCase()).toBe("span");
    // Right-align + monospace styling preserved from the pre-refactor
    // SetlistRow position span.
    expect(span.className).toContain("text-right");
    expect(span.className).toContain("font-mono");
  });
});
