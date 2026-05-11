import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NumberSlot } from "@/components/NumberSlot";

describe("NumberSlot — confirmed state (no buttons)", () => {
  it("renders the position number as a span; no buttons in DOM", () => {
    render(
      <NumberSlot
        state="confirmed"
        position={5}
        confirmAriaLabel="c"
        disagreeAriaLabel="d"
      />,
    );
    expect(screen.getByText("5")).toBeTruthy();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("regression: span carries text-right + font-mono (byte-equiv pre-Confirm-UI)", () => {
    render(
      <NumberSlot
        state="confirmed"
        position={42}
        confirmAriaLabel="c"
        disagreeAriaLabel="d"
      />,
    );
    const span = screen.getByText("42");
    expect(span.tagName.toLowerCase()).toBe("span");
    expect(span.className).toContain("text-right");
    expect(span.className).toContain("font-mono");
  });

  it("ignores myVote on confirmed rows (no buttons rendered regardless)", () => {
    render(
      <NumberSlot
        state="confirmed"
        position={5}
        myVote="confirm"
        confirmAriaLabel="c"
        disagreeAriaLabel="d"
      />,
    );
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});

describe("NumberSlot — rumoured state, dual vote buttons", () => {
  it("renders BOTH ✓ and ✕ buttons (no number, no [?]/[✓])", () => {
    render(
      <NumberSlot
        state="rumoured"
        position={3}
        confirmAriaLabel="confirm-aria"
        disagreeAriaLabel="disagree-aria"
      />,
    );
    const confirmBtn = screen.getByRole("button", { name: "confirm-aria" });
    const disagreeBtn = screen.getByRole("button", { name: "disagree-aria" });
    expect(confirmBtn.textContent).toBe("✓");
    expect(disagreeBtn.textContent).toBe("✕");
    expect(screen.queryAllByRole("button")).toHaveLength(2);
    // The position number itself is NOT rendered on rumoured rows
    // (the buttons replace it). This is intentional — the cell is
    // the vote affordance, not the position label.
    expect(screen.queryByText("3")).toBeNull();
  });

  it("myVote=\"none\" (default): both buttons render dashed-border, neither pressed", () => {
    render(
      <NumberSlot
        state="rumoured"
        position={3}
        confirmAriaLabel="c"
        disagreeAriaLabel="d"
      />,
    );
    const confirmBtn = screen.getByRole("button", { name: "c" });
    const disagreeBtn = screen.getByRole("button", { name: "d" });
    expect(confirmBtn.getAttribute("style")).toContain("dashed");
    expect(disagreeBtn.getAttribute("style")).toContain("dashed");
    expect(confirmBtn.getAttribute("aria-pressed")).toBe("false");
    expect(disagreeBtn.getAttribute("aria-pressed")).toBe("false");
  });

  it("myVote=\"confirm\": ✓ active (solid sky-blue + aria-pressed); ✕ stays muted", () => {
    render(
      <NumberSlot
        state="rumoured"
        position={3}
        myVote="confirm"
        confirmAriaLabel="c"
        disagreeAriaLabel="d"
      />,
    );
    const confirmBtn = screen.getByRole("button", { name: "c" });
    const disagreeBtn = screen.getByRole("button", { name: "d" });
    expect(confirmBtn.getAttribute("aria-pressed")).toBe("true");
    expect(confirmBtn.getAttribute("style")).toContain("solid");
    // colors.primaryBg = #e8f4fd → rgb(232, 244, 253)
    expect(confirmBtn.getAttribute("style")?.toLowerCase()).toContain(
      "rgb(232, 244, 253)",
    );
    // ✕ stays muted/dashed when only ✓ is voted.
    expect(disagreeBtn.getAttribute("aria-pressed")).toBe("false");
    expect(disagreeBtn.getAttribute("style")).toContain("dashed");
  });

  it("myVote=\"disagree\": ✕ active (solid rose-red + aria-pressed); ✓ stays muted", () => {
    render(
      <NumberSlot
        state="rumoured"
        position={3}
        myVote="disagree"
        confirmAriaLabel="c"
        disagreeAriaLabel="d"
      />,
    );
    const confirmBtn = screen.getByRole("button", { name: "c" });
    const disagreeBtn = screen.getByRole("button", { name: "d" });
    expect(disagreeBtn.getAttribute("aria-pressed")).toBe("true");
    expect(disagreeBtn.getAttribute("style")).toContain("solid");
    // colors.disagreeBg = #fff1f2 → rgb(255, 241, 242). New token
    // added in v0.10.1 specifically for this active state — the
    // assertion pins both the raw RGB and the rose-50 family
    // intent (vs colliding with `colors.live` red).
    expect(disagreeBtn.getAttribute("style")?.toLowerCase()).toContain(
      "rgb(255, 241, 242)",
    );
    // ✓ stays muted/dashed when only ✕ is voted.
    expect(confirmBtn.getAttribute("aria-pressed")).toBe("false");
    expect(confirmBtn.getAttribute("style")).toContain("dashed");
  });

  it("clicking ✓ fires onConfirmTap; clicking ✕ fires onDisagreeTap; tap handlers don't cross-fire", () => {
    const onConfirmTap = vi.fn();
    const onDisagreeTap = vi.fn();
    render(
      <NumberSlot
        state="rumoured"
        position={3}
        onConfirmTap={onConfirmTap}
        onDisagreeTap={onDisagreeTap}
        confirmAriaLabel="c"
        disagreeAriaLabel="d"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "c" }));
    expect(onConfirmTap).toHaveBeenCalledTimes(1);
    expect(onDisagreeTap).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "d" }));
    expect(onConfirmTap).toHaveBeenCalledTimes(1);
    expect(onDisagreeTap).toHaveBeenCalledTimes(1);
  });

  it("missing tap handlers are safe (no errors when buttons are clicked)", () => {
    render(
      <NumberSlot
        state="rumoured"
        position={3}
        confirmAriaLabel="c"
        disagreeAriaLabel="d"
      />,
    );
    // Both buttons clickable without throwing — admin / preview
    // contexts that don't wire the lifecycle still render safely.
    expect(() =>
      fireEvent.click(screen.getByRole("button", { name: "c" })),
    ).not.toThrow();
    expect(() =>
      fireEvent.click(screen.getByRole("button", { name: "d" })),
    ).not.toThrow();
  });
});
