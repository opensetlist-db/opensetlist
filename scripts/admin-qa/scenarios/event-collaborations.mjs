// One isolated future festival, no roster or fan submissions. Exercises
// explicit inclusion without membership and the public picker cache.
const panel = (t) => t.page.getByTestId("collaboration-settings");
const path = (t) => `/admin/events/${t.fixture.eventId}/edit`;
const save = (t) => panel(t).getByRole("button", { name: "협업 그룹 저장" });
const choice = (t) => panel(t).getByRole("checkbox", { name: "AiScReam", exact: true });

const scenario = {
  name: "event-collaborations",
  ready: '[data-testid="collaboration-settings"] input',
  container: '[data-testid="collaboration-settings"]',
  modes: {
    full: { states: [1440, 390], overflow: [320, 768], a11y: [1440, 390] },
    quick: { states: [390], overflow: [], a11y: [390] },
  },
  fixture: {
    tagPrefix: "event-collaborations",
    async create({ db, tag }) {
      const result = await db.query(
        `INSERT INTO "Event" (slug, type, "originalName", "originalLanguage", "startTime")
         VALUES ($1, 'festival', $2, 'ja', '2099-01-01T09:00:00Z'::timestamptz AT TIME ZONE 'UTC') RETURNING id`,
        [tag, `[QA] Collaboration ${tag}`],
      );
      return { eventId: String(result.rows[0].id), slug: tag };
    },
    async remove({ db, tag }) {
      // The junction has an owned cascade; remove only this run's event.
      await db.query('DELETE FROM "Event" WHERE slug = $1', [tag]);
    },
    async remaining({ db, tag }) {
      return (await db.query('SELECT count(*)::int n FROM "Event" WHERE slug = $1', [tag])).rows[0].n;
    },
  },
  async openDefault(t) {
    await t.open(path(t));
  },
  states: [
    {
      name: "explicit-appearance",
      async run(t) {
        await t.open(path(t));
        const gkss = panel(t).getByRole("checkbox", { name: "GKSS", exact: true });
        await gkss.check();
        await save(t).click();
        await panel(t).getByRole("status").waitFor();
        const control = await t.page.request.get(`${t.base}/ja/events/${t.fixture.eventId}/${t.fixture.slug}`);
        t.check(`GKSS explicit positive control@${t.width}`, control.status() === 200 && (await control.text()).includes("festival:gkss"));
        await gkss.uncheck();
        await choice(t).check();
        await save(t).click();
        await panel(t).getByRole("status").waitFor();
        await t.open(path(t));
        t.check(`included persists@${t.width}`, await choice(t).isChecked());
        const selected = await t.page.request.get(`${t.base}/ja/events/${t.fixture.eventId}/${t.fixture.slug}`);
        const html = await selected.text();
        t.check(`public explicit catalog without roster@${t.width}`, selected.status() === 200 && html.includes("festival:aiscream"));
        t.check(`GKSS unassigned@${t.width}`, html.includes("festival:aiscream") && !html.includes("festival:gkss"));
        await t.shot("included");
        await choice(t).uncheck();
        await save(t).click();
        await panel(t).getByRole("status").waitFor();
        const cleared = await t.page.request.get(`${t.base}/ja/events/${t.fixture.eventId}/${t.fixture.slug}`);
        t.check(`cleared public catalog cache@${t.width}`, cleared.status() === 200 && !(await cleared.text()).includes("festival:aiscream"));
        await t.open(path(t));
        t.check(`clear persists@${t.width}`, !(await choice(t).isChecked()));
        await t.shot("cleared");
      },
    },
    {
      name: "failed-save",
      async run(t) {
        const api = `**/api/admin/events/${t.fixture.eventId}/collaborations`;
        await choice(t).check();
        await t.page.route(api, async (route) => route.request().method() === "PATCH"
          ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "검증용 저장 실패" }) })
          : route.continue());
        await save(t).click();
        await panel(t).getByRole("alert").waitFor();
        t.check(`failed save keeps edit@${t.width}`, await choice(t).isChecked() && await save(t).isEnabled());
        await t.shot("save-failed");
        await t.page.unroute(api);
        await save(t).click();
        await panel(t).getByRole("status").waitFor();
        t.check(`retry succeeds@${t.width}`, await panel(t).getByRole("status").isVisible());
      },
    },
  ],
};

export default scenario;
