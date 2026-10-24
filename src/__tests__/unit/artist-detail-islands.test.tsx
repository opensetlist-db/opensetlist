import { describe, it, expect } from "vitest";
import Link from "next/link";
import { fireEvent, render, screen } from "@testing-library/react";
import { UnitsToggle } from "@/components/artists/UnitsToggle";
import { ArtistHistoryGroup } from "@/components/artists/ArtistHistoryGroup";

/*
 * The artist detail page's two client islands: the other-units
 * disclosure and the collapsible history group. Both keep their region
 * in the DOM and toggle `hidden`, so the tests read `hidden` and
 * `aria-expanded` rather than presence.
 */

describe("UnitsToggle", () => {
  const renderToggle = () =>
    render(
      <UnitsToggle
        mainCards={[<span key="m">Main unit</span>]}
        otherCards={[<span key="o">Other unit</span>]}
        showLabel="Show other units (1)"
        hideLabel="Hide other units"
      />,
    );

  it("starts with other units hidden and reveals them on click", () => {
    renderToggle();
    // Positive control: the main grid renders and the other card exists
    // in the DOM, so "hidden" below is about visibility, not absence.
    expect(screen.getByText("Main unit")).toBeVisible();
    const other = screen.getByText("Other unit");
    const region = other.closest("ul");
    expect(region).not.toBeNull();
    expect(region).toHaveAttribute("hidden");

    const button = screen.getByRole("button", { name: "Show other units (1)" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveAttribute("aria-controls", region!.id);

    fireEvent.click(button);
    expect(region).not.toHaveAttribute("hidden");
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveTextContent("Hide other units");

    fireEvent.click(button);
    expect(region).toHaveAttribute("hidden");
  });

  it("renders no button when there are no other units", () => {
    render(
      <UnitsToggle
        mainCards={[<span key="m">Main unit</span>]}
        otherCards={[]}
        showLabel="Show"
        hideLabel="Hide"
      />,
    );
    expect(screen.getByText("Main unit")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("ArtistHistoryGroup", () => {
  it("starts expanded and collapses/expands its rows", () => {
    render(
      <ArtistHistoryGroup
        title="5th Live Tour"
        titleLang="ja"
        countLabel="8 concerts"
        liveLabel="LIVE"
        columns={{ dateStatus: "Date · status", event: "Concert", songs: "Songs" }}
      >
        <Link href="/en/events/1/day-1">Day.1</Link>
      </ArtistHistoryGroup>,
    );
    const button = screen.getByRole("button", { name: /5th Live Tour/ });
    const body = document.getElementById(button.getAttribute("aria-controls")!);
    expect(body).not.toBeNull();
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(body).not.toHaveAttribute("hidden");
    expect(screen.getByRole("link", { name: "Day.1" })).toBeVisible();
    expect(button).toHaveTextContent("LIVE");
    expect(screen.getByText("5th Live Tour")).toHaveAttribute("lang", "ja");

    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(body).toHaveAttribute("hidden");

    fireEvent.click(button);
    expect(body).not.toHaveAttribute("hidden");
  });

  it("omits the LIVE pill when no event is ongoing", () => {
    render(
      <ArtistHistoryGroup
        title="Standalone"
        countLabel="1 concert"
        liveLabel={null}
        columns={{ dateStatus: "D", event: "E", songs: "S" }}
      >
        <Link href="/en/events/2/x">Row</Link>
      </ArtistHistoryGroup>,
    );
    const button = screen.getByRole("button", { name: /Standalone/ });
    // Positive control: the count label renders in the same slot.
    expect(button).toHaveTextContent("1 concert");
    expect(button).not.toHaveTextContent("LIVE");
  });
});
