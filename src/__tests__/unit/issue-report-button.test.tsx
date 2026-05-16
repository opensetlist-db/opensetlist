import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import { IssueReportButton } from "@/components/IssueReportButton";

describe("IssueReportButton", () => {
  it("renders the i18n label", () => {
    render(<IssueReportButton setlistItemId={42} onReport={vi.fn()} />);
    expect(screen.getByText("buttonLabel")).toBeInTheDocument();
  });

  it("invokes onReport with the row's setlistItemId on click", () => {
    const onReport = vi.fn();
    render(<IssueReportButton setlistItemId={42} onReport={onReport} />);
    fireEvent.click(screen.getByText("buttonLabel"));
    expect(onReport).toHaveBeenCalledWith(42);
  });
});
