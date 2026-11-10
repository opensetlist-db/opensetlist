import { isDeepStrictEqual } from "node:util";
import { JSDOM } from "jsdom";

const FESTIVAL_GROUPS = ["muse", "aqours", "nijigasaki", "liella", "hasunosora", "ikizurai-bu"];
const rosterLinks = '#event-performers a[href*="/members/"]';
const artistLinks = '#event-performers a[href*="/artists/"]';
const entityId = (href) => href.split("/").at(-2);

async function get(base, path) {
  const url = new URL(path, base);
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (new URL(response.url).origin !== url.origin) throw new Error("Deployment redirected outside its origin");
  if (!response.ok) throw new Error(`${response.url}: HTTP ${response.status}`);
  return response;
}

const setlist = async (base, id) =>
  (await get(base, `/api/setlist?eventId=${id}&locale=ja`)).json();

async function readRoster(base, path) {
  const dom = new JSDOM(await (await get(base, path)).text());
  try {
    return [...dom.window.document.querySelectorAll(rosterLinks)]
      .map((link) => entityId(link.getAttribute("href")));
  } finally {
    dom.window.close();
  }
}

async function board(base, id) {
  const state = await (await get(base, `/api/events/${id}/board?locale=ja`)).json();
  // The aggregate is cached separately on each deployment.
  delete state.asOf;
  return state;
}

function recordedItems(items) {
  return items.map((item) => ({
    id: item.id,
    position: item.position,
    encore: item.isEncore,
    songs: item.songs.map(({ song, order }) => [song.id, order]),
    performers: item.performers.map(({ stageIdentity, realPerson }) => [stageIdentity.id, realPerson?.id ?? null]).sort(),
    artists: item.artists.map(({ artist }) => artist.orderId ?? String(artist.id)).sort(),
  }));
}

function comparisonDeployment(value, candidate, field) {
  const url = new URL(value);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password ||
      url.origin === new URL(candidate).origin) {
    throw new Error(field + " must be a distinct HTTP(S) deployment URL without credentials");
  }
  return url;
}

export async function checkEventOrdering(h, fx, songs) {
  const baseline = comparisonDeployment(fx.orderingBaseline, h.base, "orderingBaseline");
  const reference = comparisonDeployment(fx.orderingReference ?? fx.orderingBaseline, h.base, "orderingReference");

  for (const id of [109, 110]) {
    await h.section(`official order: festival ${id}`, async () => {
      const [before, after] = await Promise.all([setlist(baseline, id), setlist(h.base, id)]);
      const comparable = before.status === after.status && before.items.length === after.items.length;
      h.check("deployment status and setlist item count match", comparable,
      `${before.status}/${after.status}, items ${before.items.length}/${after.items.length}`);
      if (!comparable) return;
      if (after.status !== "upcoming") {
        return h.skip(`festival ${id}: scheduled roster`, `observed ${before.status}/${after.status}, items ${before.items.length}/${after.items.length}`);
      }
      const path = `/ja/events/${id}`;
      const previousIds = await readRoster(baseline, path);
      const expectedOrder = reference.origin === baseline.origin ? previousIds : await readRoster(reference, path);

      const { page, resp } = await h.open(path, {
        width: 390,
        waitUntil: "domcontentloaded",
        waitForFonts: false,
        beforeNavigate: async ({ ctx }) => {
          await ctx.route("**/api/**", (route) =>
            ["GET", "HEAD"].includes(route.request().method()) ? route.continue() : route.abort());
          await ctx.addInitScript(({ eventId, predictions }) => {
            localStorage.setItem(`predict-${eventId}`, JSON.stringify({
              eventId: String(eventId), songs: predictions, savedAt: new Date().toISOString(), lockedAt: null,
            }));
          }, { eventId: id, predictions: songs });
        },
      });
      if (!resp?.ok() || new URL(resp.url()).origin !== new URL(h.base).origin) {
        throw new Error(`festival ${id} candidate page unavailable (HTTP ${resp?.status()})`);
      }
      const ids = (await page.locator(rosterLinks).evaluateAll((links) =>
        links.map((link) => link.getAttribute("href")))).map(entityId);
      h.check("roster ID set preserved", ids.length > 0 && new Set(ids).size === ids.length &&
        isDeepStrictEqual([...ids].sort(), [...previousIds].sort()), `${previousIds.length} → ${ids.length}`);
      h.check("official roster ID sequence matches reference", ids.length > 0 &&
        isDeepStrictEqual(ids, expectedOrder), `${ids.length} members`);
      const groups = (await page.locator(artistLinks).evaluateAll((links) =>
        links.map((link) => link.getAttribute("href").split("/").at(-1))))
        .filter((slug) => FESTIVAL_GROUPS.includes(slug));
      h.check("official groups appear in order", isDeepStrictEqual(groups, FESTIVAL_GROUPS), groups.join(", "));

      const [oldBoard, newBoard] = await Promise.all([board(baseline, id), board(h.base, id)]);
      h.check("fan board groups and aggregate preserved", Boolean(newBoard.groups?.length) &&
        isDeepStrictEqual(oldBoard, newBoard), `${newBoard.groups?.length ?? 0} groups`);

      await page.getByTestId("setlist-tab-predicted").click();
      await page.getByTestId("personal-share-open").click();
      const card = page.getByTestId("personal-share-card").first();
      const body = await card.innerText();
      let offset = -1;
      const inOrder = songs.every(({ song: { originalTitle } }) => {
        offset = body.indexOf(originalTitle, offset + 1);
        return offset >= 0;
      });
      h.check("stored predictions restored in order", inOrder &&
        await card.getByTestId("personal-share-primary-score").innerText() === String(songs.length),
      `${songs.length} predictions`);
    });
  }

  await h.section("official order: historical credits", async () => {
    const [before, after] = await Promise.all([setlist(baseline, 8), setlist(h.base, 8)]);
    if (before.items.length === 0 && after.items.length === 0) {
      return h.skip("event 8 historical credits", `no setlist rows (${before.status}/${after.status}); use the isolated official-order integration fixture`);
    }
    h.check("event 8 recorded credits and song order preserved",
      isDeepStrictEqual(recordedItems(before.items), recordedItems(after.items)),
      `${before.items.length} → ${after.items.length} items`);
  });
}
