import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import EventSeriesForm from "@/app/admin/event-series/EventSeriesForm";
import type { LogoCardStatus } from "@/components/admin/LogoAssignmentCard";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/components/admin/artistPicker", () => ({
  fetchAdminArtists: async () => [],
  UnlistedArtistOption: () => null,
}));

vi.mock("@/components/admin/LogoAssignmentCard", () => ({
  default: ({ onStatusChange, otherDirty }: {
    onStatusChange: (status: LogoCardStatus) => void;
    otherDirty: boolean;
  }) => (
    <button type="button" data-main-dirty={otherDirty}
      onClick={() => onStatusChange({ dirty: true, busy: false })}>
      로고 초안
    </button>
  ),
}));

afterEach(() => vi.unstubAllGlobals());

it("removes a translation added on a prior save while a logo draft is open", async () => {
  const submitted: { removeTranslations: string[]; translations: { locale: string }[] }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "PUT") submitted.push(JSON.parse(String(init.body)));
    return Response.json([]);
  }));

  const translation = { shortName: "", description: "", organizerName: "" };
  const preview = { imageUrl: null, reason: "exhausted" as const, source: null };
  render(<EventSeriesForm initialData={{
    id: 1, type: "standalone", artistId: null, parentSeriesId: null, organizerName: null,
    hasBoard: false, originalName: "公演", originalShortName: "", originalDescription: "",
    originalLanguage: "ja", translations: [
      { ...translation, locale: "ko", name: "공연" },
      { ...translation, locale: "ja", name: "公演" },
    ],
  }} logo={{ initialState: {
    assignment: { mode: "inherit", assetId: null }, asset: null, applied: preview,
    previews: { inherit: preview, typography: preview }, attempt: null,
  } }} />);

  fireEvent.click(screen.getByRole("button", { name: "로고 초안" }));
  fireEvent.click(screen.getByRole("button", { name: /언어 추가/ }));
  fireEvent.change(screen.getAllByPlaceholderText("이름")[2], { target: { value: "Concert" } });
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());
  expect(submitted[0].translations.map((row) => row.locale)).toEqual(["ko", "ja", "en"]);

  fireEvent.click(screen.getAllByRole("button", { name: "삭제" })[2]);
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  await waitFor(() => expect(submitted[1]?.removeTranslations).toEqual(["en"]));
  await waitFor(() => expect(screen.getByRole("button", { name: "로고 초안" }).getAttribute("data-main-dirty")).toBe("false"));
});
