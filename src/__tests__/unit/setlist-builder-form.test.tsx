import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import SetlistBuilder from "@/app/admin/events/SetlistBuilder";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/SongSearch", () => ({
  SongSearch: ({ onSelect }: { onSelect: (song: object) => void }) => (
    <button onClick={() => onSelect({ id: 100, originalTitle: "합동곡", translations: [], artists: [] })}>
      합동곡 선택
    </button>
  ),
}));

const translations = (name: string) => [{ locale: "ko", name }];
const muse = { id: 20, type: "group" as const, parentArtistId: null, sortOrder: 1, translations: translations("뮤즈") };
const aqours = { id: 10, type: "group" as const, parentArtistId: null, sortOrder: 2, translations: translations("아쿠아") };
function performer(name: string, group: typeof muse | typeof aqours, sortOrder: number) {
  return {
    id: name, sortOrder: null, createdAt: "2026-01-01T00:00:00Z", translations: translations(name),
    artistLinks: [{ artistId: group.id, sortOrder, artist: group }],
  };
}
const roster = [performer("치카", aqours, 1), performer("코토리", muse, 2), performer("호노카", muse, 1)];

afterEach(() => vi.unstubAllGlobals());

it("adds both groups via ordinary search results and saves official artist and performer order", async () => {
  const fetchMock = vi.fn(async (url: string) => Response.json(
    url.includes("?q=") ? [url.endsWith("aqours") ? aqours : muse]
      : url.endsWith("stage-identities") ? roster : { setlistItems: [] },
  ));
  vi.stubGlobal("fetch", fetchMock);
  render(<SetlistBuilder eventId={1} initialItems={[]} eventPerformers={roster}
    artistOrder={[aqours, muse]} eventGuestIds={[]} />);

  fireEvent.click(screen.getByRole("button", { name: "+ 세트리스트 항목 추가" }));
  const search = screen.getByPlaceholderText("아티스트 검색...");
  for (const [query, name] of [["aqours", "아쿠아"], ["muse", "뮤즈"]]) {
    fireEvent.change(search, { target: { value: query } });
    fireEvent.click(await screen.findByRole("button", { name }));
  }
  expect(screen.getByText("아쿠아", { exact: true })).toBeInTheDocument();
  expect(screen.getByText("뮤즈", { exact: true })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "합동곡 선택" }));
  const artistSummary = screen.getByText("아티스트 (그룹/유닛/솔로)");
  const songSummary = screen.getByText("곡 (복수 선택 = 메들리)");
  const performerSummary = screen.getByText("출연진");
  for (const summary of [artistSummary, songSummary, performerSummary]) {
    expect(summary.closest("details")).toHaveAttribute("open");
    fireEvent.click(summary);
    expect(summary.closest("details")).not.toHaveAttribute("open");
  }
  fireEvent.click(performerSummary);
  expect(artistSummary.closest("details")).not.toHaveAttribute("open");
  const performers = screen.getByText("호노카", { exact: true }).parentElement;
  expect(performers).toBeTruthy();
  if (!performers) throw new Error("Missing performer list");
  expect(within(performers).getAllByRole("button").map((button) => button.getAttribute("aria-label")))
    .toEqual(["호노카 제거", "코토리 제거", "치카 제거"]);

  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/admin/setlist-items", expect.objectContaining({ method: "POST" })));
  expect(fetchMock).toHaveBeenCalledWith("/api/admin/setlist-items", expect.objectContaining({
    body: expect.stringContaining('"artistIds":[20,10]'),
  }));
  expect(fetchMock).toHaveBeenCalledWith("/api/admin/setlist-items", expect.objectContaining({
    body: expect.stringContaining('"performerIds":["호노카","코토리","치카"]'),
  }));
  expect(fetchMock).toHaveBeenCalledWith("/api/admin/setlist-items", expect.objectContaining({
    body: expect.stringContaining('"songIds":[100]'),
  }));

  fireEvent.click(await screen.findByRole("button", { name: "+ 세트리스트 항목 추가" }));
  expect(screen.queryByText("아쿠아", { exact: true })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "직전 아티스트 불러오기" }));
  expect(screen.getByText("아쿠아", { exact: true })).toBeInTheDocument();
  expect(screen.getByText("뮤즈", { exact: true })).toBeInTheDocument();
});

it("keeps the form available when the performer catalog returns an error", async () => {
  const reply = Response.json({ error: "unauthorized" }, { status: 401 });
  const fetchMock = vi.fn(async () => reply);
  vi.stubGlobal("fetch", fetchMock);
  render(<SetlistBuilder eventId={1} initialItems={[]} eventPerformers={roster}
    artistOrder={[aqours, muse]} eventGuestIds={[]} />);

  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/admin/stage-identities"));
  fireEvent.click(screen.getByRole("button", { name: "+ 세트리스트 항목 추가" }));
  expect(screen.getByRole("button", { name: "호노카 제거" })).toBeInTheDocument();
});
