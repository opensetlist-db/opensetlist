import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "@testing-library/react";
import {
  fetchAdminArtists,
  UnlistedArtistOption,
} from "@/components/admin/artistPicker";

// Shared by every admin artist <select>. See admin-song-form-artist-picker
// for the end-to-end song form case.
describe("UnlistedArtistOption", () => {
  function renderSelect(
    value: string | number,
    options: { id: string | number }[],
    label?: string,
  ) {
    const { container } = render(
      <select value={value} onChange={() => {}}>
        <option value="">없음</option>
        <UnlistedArtistOption value={value} options={options} label={label} />
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {`artist ${o.id}`}
          </option>
        ))}
      </select>,
    );
    return container.querySelector("select") as HTMLSelectElement;
  }

  it("renders nothing when the value is in the list (string vs number ids)", () => {
    const select = renderSelect("1", [{ id: 1 }, { id: 2 }]);
    expect(select.options).toHaveLength(3);
    expect(select.selectedOptions[0].textContent).toBe("artist 1");
  });

  it("renders nothing for the empty placeholder value", () => {
    const select = renderSelect("", [{ id: 2 }]);
    expect(select.options).toHaveLength(2);
    expect(select.selectedOptions[0].textContent).toBe("없음");
  });

  it("keeps an unlisted value selected instead of the placeholder", () => {
    const select = renderSelect("1", [{ id: 2 }]);
    expect(select.value).toBe("1");
    expect(select.selectedOptions[0].textContent).toBe("ID: 1 (목록에 없음)");
  });

  it("uses the supplied label", () => {
    const select = renderSelect(1, [], "하스노소라");
    expect(select.selectedOptions[0].textContent).toBe("하스노소라 (목록에 없음)");
  });
});

describe("fetchAdminArtists", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns the array body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ json: () => Promise.resolve([{ id: 1 }]) }),
    );
    await expect(fetchAdminArtists()).resolves.toEqual([{ id: 1 }]);
  });

  it("returns [] for an error body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ json: () => Promise.resolve({ error: "x" }) }),
    );
    await expect(fetchAdminArtists()).resolves.toEqual([]);
  });

  it("returns [] on a network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(fetchAdminArtists()).resolves.toEqual([]);
  });
});
