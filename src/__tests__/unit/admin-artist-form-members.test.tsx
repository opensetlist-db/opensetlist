import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import ArtistForm from "@/app/admin/artists/ArtistForm";

// The artist form's member list (edit mode) re-sorts itself after a
// local change. It must land on the order the server reads back
// (`src/lib/memberOrder.ts`: sortOrder nulls last → createdAt → id),
// and linking an existing member must carry that member's stored
// fields — 편집 → 저장 PUTs all of them, so a placeholder would
// overwrite the stored number.

const baseInitial = {
  id: 5,
  type: "group",
  parentArtistId: null,
  hasBoard: true,
  category: null,
  isMainUnit: false,
  color: null,
  sortOrder: null,
  isSideProject: false,
  originalName: "グループ",
  originalShortName: "",
  originalBio: "",
  originalLanguage: "ja",
  translations: [{ locale: "ko", name: "그룹", shortName: "", bio: "" }],
  groupIds: [],
};

// Server order: A is numbered (#1); B is unnumbered but older than A.
const memberA = {
  id: "si-a",
  type: "character",
  color: "#aa0000",
  sortOrder: 1,
  createdAt: "2024-01-02T00:00:00.000Z",
  name: "멤버A",
  vaName: null,
};
const memberB = {
  id: "si-b",
  type: "character",
  color: null,
  sortOrder: null,
  createdAt: "2024-01-01T00:00:00.000Z",
  name: "멤버B",
  vaName: null,
};

// An identity of another artist, numbered #2, offered by "기존 멤버 연결".
const linkable = {
  id: "si-x",
  type: "persona",
  color: "#112233",
  sortOrder: 2,
  createdAt: "2024-03-01T00:00:00.000Z",
  translations: [{ locale: "ko", name: "엑스" }],
  artistLinks: [],
};

type Call = { url: string; method: string; body: unknown };
let calls: Call[];

function mockApi() {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({
        url,
        method,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      const json = (data: unknown) => ({ ok: true, json: () => Promise.resolve(data) });
      if (url === "/api/admin/stage-identities" && method === "GET") return json([linkable]);
      if (url === "/api/admin/groups" || url === "/api/admin/artists") return json([]);
      if (url.endsWith("/stage-identities") && method === "PUT") return json({ sortOrder: JSON.parse(String(init?.body)).sortOrder });
      return json({ ok: true });
    }),
  );
}

// Member names in on-screen order (the `font-medium` name span of each row).
function memberOrder(): string[] {
  return Array.from(document.querySelectorAll("span.font-medium")).map(
    (el) => el.textContent ?? "",
  );
}

function rowOf(name: string): HTMLElement {
  return screen.getByText(name, { selector: "span.font-medium" }).parentElement as HTMLElement;
}

async function openEditor(name: string) {
  fireEvent.click(within(rowOf(name)).getByRole("button", { name: "편집" }));
  const input = (await screen.findByLabelText("기본 멤버 순서", {
    selector: "input[placeholder='정렬 순서 (비우면 미지정)']",
  })) as HTMLInputElement;
  return { input, editor: input.closest(".bg-blue-50") as HTMLElement };
}

describe("ArtistForm member list", () => {
  beforeEach(() => mockApi());
  afterEach(() => vi.unstubAllGlobals());

  it("linking an existing member keeps its stored number and sorts it in", async () => {
    render(
      <ArtistForm
        initialData={{ ...baseInitial, existingStageIdentities: [memberA, memberB] }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "기존 멤버 연결" }));
    const select = (await screen.findByRole("option", { name: /엑스/ })).closest(
      "select",
    ) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "si-x" } });

    // #1 A, #2 X (the linked member's own number), then unnumbered B.
    await waitFor(() => expect(memberOrder()).toEqual(["멤버A", "엑스", "멤버B"]));
    expect(within(rowOf("엑스")).getByText("#2")).toBeTruthy();

    // 편집 shows the stored number, and 저장 sends it (and the stored
    // type / color) back instead of clearing them.
    const { input, editor } = await openEditor("엑스");
    expect(input.value).toBe("2");
    fireEvent.click(within(editor).getByRole("button", { name: "저장" }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === "PUT")).toBe(true),
    );
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.url).toBe("/api/admin/stage-identities/si-x");
    expect(put.body).toMatchObject({ sortOrder: 2, type: "persona", color: "#112233" });
  });

  it("clearing a number re-sorts by creation order, like the server", async () => {
    render(
      <ArtistForm
        initialData={{ ...baseInitial, existingStageIdentities: [memberA, memberB] }}
      />,
    );
    expect(memberOrder()).toEqual(["멤버A", "멤버B"]);

    const { input, editor } = await openEditor("멤버A");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.click(within(editor).getByRole("button", { name: "저장" }));

    // Both unnumbered now: the older B comes first, as a reload shows.
    await waitFor(() => expect(memberOrder()).toEqual(["멤버B", "멤버A"]));
  });

  it("saves and clears only the selected relationship rank; keeps default rank", async () => {
    render(<ArtistForm initialData={{ ...baseInitial, type: "unit", existingStageIdentities: [memberA, memberB] }} />);
    const input = screen.getByLabelText("멤버B — 이 아티스트의 관계순");
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "멤버B 관계순 저장" }));
    await waitFor(() => expect(memberOrder()).toEqual(["멤버B", "멤버A"]));
    expect(calls.find((call) => call.method === "PUT")?.body).toEqual({ stageIdentityId: "si-b", sortOrder: 0 });
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "멤버B 관계순 저장" }));
    await waitFor(() => expect(memberOrder()).toEqual(["멤버A", "멤버B"]));
    const { input: defaultRank } = await openEditor("멤버A");
    expect(defaultRank.value).toBe("1");
  });

  it("rejects a fraction locally and retains draft on a failed save", async () => {
    render(<ArtistForm initialData={{ ...baseInitial, existingStageIdentities: [memberA] }} />);
    const input = screen.getByLabelText("멤버A — 이 아티스트의 관계순");
    fireEvent.change(input, { target: { value: "1.5" } });
    fireEvent.click(screen.getByRole("button", { name: "멤버A 관계순 저장" }));
    expect(screen.getByText(/정수를 입력하세요/)).toBeTruthy();
    expect(calls.filter((call) => call.method === "PUT")).toHaveLength(0);
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, json: async () => ({ error: "fixture failure" }) } as Response);
    fireEvent.change(input, { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "멤버A 관계순 저장" }));
    await screen.findByText("fixture failure");
    expect((input as HTMLInputElement).value).toBe("2");
    expect(memberOrder()).toEqual(["멤버A"]);
  });
});
