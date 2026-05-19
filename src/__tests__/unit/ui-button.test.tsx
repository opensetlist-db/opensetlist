import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PrimaryButton, SecondaryButton } from "@/components/ui/Button";
import { colors, gradients } from "@/styles/tokens";
import { hexToRgbString } from "../utils/color";

describe("<PrimaryButton>", () => {
  it("renders children + default type='button'", () => {
    render(<PrimaryButton>Share 🎯</PrimaryButton>);
    const btn = screen.getByRole("button", { name: "Share 🎯" });
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute("type", "button");
  });

  it("type='submit' is honored", () => {
    render(<PrimaryButton type="submit">Submit</PrimaryButton>);
    expect(screen.getByRole("button")).toHaveAttribute("type", "submit");
  });

  it("fullWidth → width: 100%", () => {
    render(<PrimaryButton fullWidth>x</PrimaryButton>);
    expect(screen.getByRole("button")).toHaveStyle({ width: "100%" });
  });

  it("default (not fullWidth) → width: auto", () => {
    render(<PrimaryButton>x</PrimaryButton>);
    expect(screen.getByRole("button")).toHaveStyle({ width: "auto" });
  });

  it("renders the brand gradient when not pressed or disabled", () => {
    render(<PrimaryButton>x</PrimaryButton>);
    expect(screen.getByRole("button")).toHaveStyle({
      background: colors.brandGradient,
    });
  });

  it("onPointerDown swaps gradient to pressed; onPointerUp reverts", () => {
    render(<PrimaryButton>x</PrimaryButton>);
    const btn = screen.getByRole("button");
    fireEvent.pointerDown(btn);
    expect(btn).toHaveStyle({ background: gradients.brandGradientPressed });
    expect(btn).toHaveStyle({ transform: "scale(0.97)" });
    fireEvent.pointerUp(btn);
    expect(btn).toHaveStyle({ background: colors.brandGradient });
    expect(btn).toHaveStyle({ transform: "scale(1)" });
  });

  it("pointerLeave / pointerCancel also clear the pressed state", () => {
    render(<PrimaryButton>x</PrimaryButton>);
    const btn = screen.getByRole("button");
    fireEvent.pointerDown(btn);
    fireEvent.pointerLeave(btn);
    expect(btn).toHaveStyle({ background: colors.brandGradient });
    fireEvent.pointerDown(btn);
    fireEvent.pointerCancel(btn);
    expect(btn).toHaveStyle({ background: colors.brandGradient });
  });

  it("disabled → disabled attr + grayscale gradient + cursor not-allowed", () => {
    render(<PrimaryButton disabled>x</PrimaryButton>);
    const btn = screen.getByRole("button") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn).toHaveStyle({ cursor: "not-allowed" });
    // grayscale ramp (#94a3b8 → #64748b). jsdom normalizes inline
    // hex literals to `rgb(r, g, b)` — compare against the
    // rgb-stringified form via the shared helper.
    expect(btn.style.background).toContain(hexToRgbString("#94a3b8"));
    expect(btn.style.background).toContain(hexToRgbString("#64748b"));
  });

  it("disabled ignores pointer events (pressed state never latches)", () => {
    render(<PrimaryButton disabled>x</PrimaryButton>);
    const btn = screen.getByRole("button");
    fireEvent.pointerDown(btn);
    // Background stays grayscale, NOT brandGradientPressed (#0288d1
    // → rgb(2, 136, 209)). Same jsdom-normalization caveat as above.
    expect(btn.style.background).not.toContain(hexToRgbString("#0288d1"));
    expect(btn).toHaveStyle({ transform: "scale(1)" });
  });

  it("disabled drops onClick", () => {
    const onClick = vi.fn();
    render(
      <PrimaryButton disabled onClick={onClick}>
        x
      </PrimaryButton>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("onClick fires when not disabled", () => {
    const onClick = vi.fn();
    render(<PrimaryButton onClick={onClick}>x</PrimaryButton>);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("style prop overrides variant defaults (last-write-wins cascade)", () => {
    render(
      <PrimaryButton fullWidth style={{ width: "200px" }}>
        x
      </PrimaryButton>,
    );
    // Variant's `fullWidth: "100%"` lands first; style prop's `200px`
    // wins in the spread.
    expect(screen.getByRole("button")).toHaveStyle({ width: "200px" });
  });

  it("ariaLabel reaches aria-label attribute", () => {
    render(<PrimaryButton ariaLabel="share results">x</PrimaryButton>);
    expect(
      screen.getByRole("button", { name: "share results" }),
    ).toBeInTheDocument();
  });

  it("className applies to the rendered button", () => {
    render(<PrimaryButton className="hidden lg:flex">x</PrimaryButton>);
    expect(screen.getByRole("button")).toHaveClass("hidden", "lg:flex");
  });
});

describe("<SecondaryButton>", () => {
  it("renders children + resting style (textSecondary on white)", () => {
    render(<SecondaryButton>Add a song</SecondaryButton>);
    const btn = screen.getByRole("button", { name: "Add a song" });
    expect(btn).toHaveStyle({
      color: hexToRgbString(colors.textSecondary),
      background: "white",
    });
  });

  it("border uses colors.border at 1.5px solid", () => {
    render(<SecondaryButton>x</SecondaryButton>);
    // jsdom normalizes border shorthand to per-side properties; pick
    // borderTopColor (canary) since all four sides share the value.
    expect(screen.getByRole("button")).toHaveStyle({
      borderTopColor: hexToRgbString(colors.border),
    });
  });

  it("pointerEnter flips bg + color to brand hover; pointerLeave reverts", () => {
    render(<SecondaryButton>x</SecondaryButton>);
    const btn = screen.getByRole("button");
    fireEvent.pointerEnter(btn);
    expect(btn).toHaveStyle({
      background: hexToRgbString(colors.primaryHoverBg),
      color: hexToRgbString(colors.primary),
    });
    fireEvent.pointerLeave(btn);
    expect(btn).toHaveStyle({
      background: "white",
      color: hexToRgbString(colors.textSecondary),
    });
  });

  it("disabled secondary: hover never latches", () => {
    render(<SecondaryButton disabled>x</SecondaryButton>);
    const btn = screen.getByRole("button");
    fireEvent.pointerEnter(btn);
    expect(btn).toHaveStyle({
      background: "white",
      color: hexToRgbString(colors.textSecondary),
    });
  });

  it("disabled → disabled attr + opacity 0.5 + cursor not-allowed", () => {
    render(<SecondaryButton disabled>x</SecondaryButton>);
    const btn = screen.getByRole("button") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn).toHaveStyle({ opacity: "0.5", cursor: "not-allowed" });
  });

  it("disabled drops onClick", () => {
    const onClick = vi.fn();
    render(
      <SecondaryButton disabled onClick={onClick}>
        x
      </SecondaryButton>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("onClick fires when not disabled", () => {
    const onClick = vi.fn();
    render(<SecondaryButton onClick={onClick}>x</SecondaryButton>);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("fullWidth → width: 100%", () => {
    render(<SecondaryButton fullWidth>x</SecondaryButton>);
    expect(screen.getByRole("button")).toHaveStyle({ width: "100%" });
  });

  it("style prop overrides variant defaults", () => {
    render(<SecondaryButton style={{ flex: 1 }}>x</SecondaryButton>);
    expect(screen.getByRole("button")).toHaveStyle({ flex: "1" });
  });

  it("ariaLabel reaches aria-label attribute", () => {
    render(<SecondaryButton ariaLabel="open search">x</SecondaryButton>);
    expect(
      screen.getByRole("button", { name: "open search" }),
    ).toBeInTheDocument();
  });

  it("className applies to the rendered button", () => {
    render(<SecondaryButton className="mt-2">x</SecondaryButton>);
    expect(screen.getByRole("button")).toHaveClass("mt-2");
  });

  it("type='submit' is honored", () => {
    render(<SecondaryButton type="submit">x</SecondaryButton>);
    expect(screen.getByRole("button")).toHaveAttribute("type", "submit");
  });
});
