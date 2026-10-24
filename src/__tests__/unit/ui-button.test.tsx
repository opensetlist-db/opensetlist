import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PrimaryButton, SecondaryButton } from "@/components/ui/Button";
import { colors } from "@/styles/tokens";
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

  it("announces busy work and clears it when the operation settles", () => {
    const { rerender } = render(<PrimaryButton busy disabled>Share</PrimaryButton>);
    expect(screen.getByRole("button")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button")).toBeDisabled();
    rerender(<PrimaryButton>Share</PrimaryButton>);
    expect(screen.getByRole("button")).not.toHaveAttribute("aria-busy");
    expect(screen.getByRole("button")).toBeEnabled();
  });

  it("disabled drops onClick", () => {
    const onClick = vi.fn();
    const { rerender } = render(<PrimaryButton onClick={onClick}>x</PrimaryButton>);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledOnce();
    rerender(<PrimaryButton disabled onClick={onClick}>x</PrimaryButton>);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledOnce();
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
