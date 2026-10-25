import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CollaborationSettings from "@/app/admin/events/CollaborationSettings";

const settings = { artists: [
  { artistId: "41", label: "AiScReam", included: true },
  { artistId: "82", label: "GKSS", included: false },
] };
afterEach(() => vi.unstubAllGlobals());

describe("CollaborationSettings", () => {
  it("loads explicit choices, saves exactly the checked groups, and clears its saved state on an edit", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json(settings))
      .mockResolvedValueOnce(Response.json({ artistIds: ["82"] }));
    vi.stubGlobal("fetch", fetchMock);
    render(<CollaborationSettings eventId={107} />);
    const aiscream = await screen.findByRole("checkbox", { name: "AiScReam" });
    const gkss = screen.getByRole("checkbox", { name: "GKSS" });
    expect(aiscream).toBeChecked();
    expect(gkss).not.toBeChecked();
    fireEvent.click(aiscream);
    fireEvent.click(gkss);
    fireEvent.click(screen.getByRole("button", { name: "협업 그룹 저장" }));
    expect(await screen.findByRole("status")).toHaveTextContent("저장했습니다");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ artistIds: ["82"] });
    fireEvent.click(gkss);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keeps edited choices and permits retry after a save failure", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json(settings))
      .mockResolvedValueOnce(Response.json({ error: "저장 오류" }, { status: 500 }))
      .mockResolvedValueOnce(Response.json({ artistIds: [] }));
    vi.stubGlobal("fetch", fetchMock);
    render(<CollaborationSettings eventId={107} />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "AiScReam" }));
    fireEvent.click(screen.getByRole("button", { name: "협업 그룹 저장" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("저장 오류");
    expect(screen.getByRole("checkbox", { name: "AiScReam" })).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "협업 그룹 저장" }));
    expect(await screen.findByRole("status")).toHaveTextContent("저장했습니다");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("retries a failed load", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("네트워크 오류"))
      .mockResolvedValueOnce(Response.json(settings)));
    render(<CollaborationSettings eventId={107} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("네트워크 오류");
    fireEvent.click(screen.getByRole("button", { name: "다시 불러오기" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "AiScReam" })).toBeChecked());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
