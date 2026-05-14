import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import { RowContestButton } from "@/components/RowContestButton";

describe("RowContestButton", () => {
  it("renders the i18n label", () => {
    render(<RowContestButton position={5} onContest={vi.fn()} />);
    // The mocked useTranslations returns the key string; the
    // button renders the contestRowLabel key from the AddItem
    // namespace.
    expect(screen.getByText("contestRowLabel")).toBeInTheDocument();
  });

  it("invokes onContest with the row's position on click", () => {
    const onContest = vi.fn();
    render(<RowContestButton position={17} onContest={onContest} />);
    fireEvent.click(screen.getByText("contestRowLabel"));
    expect(onContest).toHaveBeenCalledWith(17);
  });
});
