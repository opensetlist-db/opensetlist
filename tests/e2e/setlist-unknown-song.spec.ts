import { test, expect, type APIRequestContext } from "@playwright/test";
import { readUnknownSongSampleIds } from "./helpers/sampleIds";

/*
 * n05 — "unknown song" setlist row lifecycle (LL Fes identification job).
 *
 *   1. operator saves a song-typed row with NO song + a note (what they
 *      heard) → the slot is held
 *   2. public event page renders it as 「곡 확인 중」 and never leaks the
 *      operator note
 *   3. the polling payload (`/api/setlist`, the same endpoint the live
 *      page's polling + realtime snapshot use) round-trips the song-less
 *      row instead of dropping it
 *   4. operator assigns the song → the same row (same id, same position)
 *      comes back with the song, and the public page shows the title
 *
 * Driven through the admin JSON API rather than the builder UI: the
 * builder's search dropdowns are debounce-timed and their selectors
 * are unlocalised Korean labels that churn; the API is the contract the
 * builder itself calls, and the public-side assertions are what this
 * spec is really about. The public page is re-loaded between steps
 * instead of waiting on the live poll — the sample event is a past
 * event (polling off), and step 3 covers the polling payload directly.
 *
 * Mutates the dev DB: appends one row at the end of the sample event
 * and soft-deletes it in `finally`. Skips when the sample event id or
 * ADMIN_PASSWORD is missing (helpers/sampleIds.ts).
 */

const UNKNOWN_LABEL = "곡 확인 중"; // Setlist.unknownSong (ko)
const NOTE = `e2e-n05 들린 것 메모 ${Date.now()}`;

const { unknownSongEventId, fillSongId, adminPassword } =
  readUnknownSongSampleIds();

type PolledItem = {
  id: number;
  position: number;
  songs: Array<{ song: { id: number } }>;
};

async function polledItem(
  request: APIRequestContext,
  eventId: string,
  itemId: number,
): Promise<PolledItem | undefined> {
  const res = await request.get(`/api/setlist?eventId=${eventId}&locale=ko`);
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { items: PolledItem[] };
  return body.items.find((i) => i.id === itemId);
}

test.describe("unknown-song setlist row (n05)", () => {
  test("hold slot → 곡 확인 중 → assign song keeps id + position", async ({
    page,
  }) => {
    test.skip(
      !unknownSongEventId || !adminPassword,
      "E2E_UNKNOWN_SONG_EVENT_ID / ADMIN_PASSWORD not set",
    );
    test.skip(!fillSongId, "E2E_MULTI_ALBUM_SONG_ID not set (used as the fill-in song)");
    const eventId = unknownSongEventId!;
    const request = page.request;

    const login = await request.post("/api/admin/login", {
      data: { password: adminPassword },
    });
    expect(login.ok(), "admin login").toBeTruthy();

    // Append after the current last row (encore rows included) so the
    // encore-order validation can't reject it and existing rows keep
    // their positions.
    const eventRes = await request.get(`/api/admin/events/${eventId}`);
    expect(eventRes.ok()).toBeTruthy();
    const eventData = (await eventRes.json()) as {
      setlistItems: Array<{ position: number; isEncore: boolean }>;
    };
    const last = eventData.setlistItems.at(-1);
    const position = (last?.position ?? 0) + 1;

    const unknownCountBefore = await (async () => {
      await page.goto(`/ko/events/${eventId}`);
      return page.getByText(UNKNOWN_LABEL, { exact: true }).count();
    })();

    const created = await request.post("/api/admin/setlist-items", {
      data: {
        eventId: Number(eventId),
        position,
        isEncore: last?.isEncore ?? false,
        stageType: "full_group",
        type: "song",
        status: "confirmed",
        performanceType: "live_performance",
        note: NOTE,
        songIds: [],
        performerIds: [],
        artistIds: [],
      },
    });
    expect(created.ok(), "create unknown-song row").toBeTruthy();
    const itemId = ((await created.json()) as { id: number }).id;

    try {
      // Public page: one more 「곡 확인 중」 row, note never rendered.
      const resp = await page.goto(`/ko/events/${eventId}`);
      expect(resp?.ok()).toBeTruthy();
      await expect(page.getByText(UNKNOWN_LABEL, { exact: true })).toHaveCount(
        unknownCountBefore + 1,
      );
      await expect(page.getByText(NOTE)).toHaveCount(0);

      // Polling payload keeps the song-less row.
      const before = await polledItem(request, eventId, itemId);
      expect(before, "song-less row present in /api/setlist").toBeDefined();
      expect(before!.songs).toHaveLength(0);
      expect(before!.position).toBe(position);

      // Fill in the song — same row, same position.
      const updated = await request.put(`/api/admin/setlist-items/${itemId}`, {
        data: {
          position,
          isEncore: last?.isEncore ?? false,
          stageType: "full_group",
          type: "song",
          status: "confirmed",
          performanceType: "live_performance",
          note: null,
          songIds: [Number(fillSongId)],
          performerIds: [],
          artistIds: [],
        },
      });
      expect(updated.ok(), "assign song").toBeTruthy();

      const after = await polledItem(request, eventId, itemId);
      expect(after!.position).toBe(position);
      expect(after!.songs.map((s) => s.song.id)).toEqual([Number(fillSongId)]);

      await page.goto(`/ko/events/${eventId}`);
      await expect(page.getByText(UNKNOWN_LABEL, { exact: true })).toHaveCount(
        unknownCountBefore,
      );
      await expect(
        page.locator(`a[href^="/ko/songs/${fillSongId}"]`).first(),
      ).toBeVisible();
    } finally {
      await request.delete(`/api/admin/setlist-items/${itemId}`);
    }
  });
});
