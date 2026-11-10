// Isolated rank editing proof. Only tagged fixture rows are written;
// default rank, the other unit, translations and periods are compared.
import { randomUUID } from "node:crypto";

const edit = (id) => `/admin/artists/${id}/edit`;
const rowIds = (t) => t.page.getByTestId("admin-member").evaluateAll((rows) => rows.map((row) => row.dataset.memberId));
const input = (t, index = 1) => t.page.getByLabel(`${t.fixture.names[index]} — 이 아티스트의 관계순`);
const save = (t, index = 1) => t.page.getByRole("button", { name: `${t.fixture.names[index]} 관계순 저장` });
const request = (t) => (response) => response.url().endsWith(`/api/admin/artists/${t.fixture.a}/stage-identities`) && response.request().method() === "PUT";
const snapshot = async (t) => ({
  identities: (await t.db.query('select s.*, (select jsonb_agg(to_jsonb(x) order by x.locale) from "StageIdentityTranslation" x where x."stageIdentityId"=s.id) translations from "StageIdentity" s where s.slug like $1 order by s.id', [`${t.fixture.tag}-%`])).rows,
  otherLinks: (await t.db.query('select * from "StageIdentityArtist" where "artistId" in ($1,$2) order by id', [t.fixture.root, t.fixture.b])).rows,
  periods: (await t.db.query('select id, "stageIdentityId", "artistId", "startDate", "endDate", note from "StageIdentityArtist" where "artistId"=$1 order by id', [t.fixture.a])).rows,
});

const scenario = {
  name: "membership-order",
  ready: '[data-testid="membership-order-editor"]',
  container: '[data-testid="membership-order-editor"]',
  modes: {
    full: { states: [1440, 1024, 390, 320], overflow: [], a11y: [1440, 390] },
    quick: { states: [390, 1440], overflow: [], a11y: [390] },
  },
  fixture: {
    tagPrefix: "membershiporder",
    async create({ db, tag }) {
      const makeArtist = async (suffix, type, parent = null) => String((await db.query(
        'insert into "Artist"(slug,type,"originalName","parentArtistId") values ($1,$2::"ArtistType",$3,$4) returning id',
        [`${tag}-${suffix}`, type, `순서 fixture ${suffix}`, parent],
      )).rows[0].id);
      const root = await makeArtist("root", "group");
      const a = await makeArtist("a", "unit", root);
      const b = await makeArtist("b", "unit", root);
      const ids = [], names = ["순서 멤버 A", "순서 멤버 B", "순서 멤버 C"];
      for (const [index, name] of names.entries()) {
        const id = randomUUID(); ids.push(id);
        await db.query('insert into "StageIdentity"(id,slug,type,"originalName","sortOrder") values ($1,$2,\'character\',$3,$4)', [id, `${tag}-${index}`, name, index + 1]);
        await db.query('insert into "StageIdentityTranslation"(id,"stageIdentityId",locale,name) values ($1,$2,\'ko\',$3)', [randomUUID(), id, name]);
        for (const artistId of [root, a, b]) await db.query('insert into "StageIdentityArtist"(id,"stageIdentityId","artistId","sortOrder","startDate","endDate",note) values ($1,$2,$3,$4,\'2020-01-01\',\'2021-01-01\',\'graduated fixture\')', [randomUUID(), id, artistId, artistId === b ? [2, 1, 3][index] : null]);
      }
      return { root, a, b, ids, names, tag };
    },
    async remove({ db, tag }) {
      await db.query('delete from "StageIdentityArtist" where "stageIdentityId" in (select id from "StageIdentity" where slug like $1)', [`${tag}-%`]);
      await db.query('delete from "StageIdentityTranslation" where "stageIdentityId" in (select id from "StageIdentity" where slug like $1)', [`${tag}-%`]);
      await db.query('delete from "StageIdentity" where slug like $1', [`${tag}-%`]);
      await db.query('delete from "Artist" where slug like $1 and "parentArtistId" is not null', [`${tag}-%`]);
      await db.query('delete from "Artist" where slug like $1', [`${tag}-%`]);
    },
    async remaining({ db, tag }) {
      return (await db.query('select ((select count(*) from "StageIdentity" where slug like $1)+(select count(*) from "Artist" where slug like $1))::int n', [`${tag}-%`])).rows[0].n;
    },
  },
  async openDefault(t) {
    await t.db.query('update "StageIdentityArtist" set "sortOrder"=null where "artistId"=$1', [t.fixture.a]);
    await t.open(edit(t.fixture.a));
  },
  states: [
    { name: "default", async run(t) {
      await t.db.query('update "StageIdentityArtist" set "sortOrder"=null where "artistId"=$1', [t.fixture.a]);
      await t.open(edit(t.fixture.a));
      t.baseline = await snapshot(t);
      t.check(`default@${t.width} IDs`, JSON.stringify(await rowIds(t)) === JSON.stringify(t.fixture.ids));
      await t.shot("default");
    } },
    { name: "saved-reordered", async run(t) {
      await input(t).fill("0");
      const response = t.page.waitForResponse(request(t));
      await save(t).click();
      const result = await response;
      t.check(`saved@${t.width} response`, result.status() === 200 && (await result.json()).sortOrder === 0);
      await t.page.getByText("관계순을 저장했습니다.", { exact: true }).waitFor();
      const expected = [t.fixture.ids[1], t.fixture.ids[0], t.fixture.ids[2]];
      t.check(`saved@${t.width} IDs`, JSON.stringify(await rowIds(t)) === JSON.stringify(expected));
      await t.shot("saved-reordered");
      await t.open(edit(t.fixture.a));
      t.check(`reload@${t.width} IDs`, JSON.stringify(await rowIds(t)) === JSON.stringify(expected));
      t.check(`preserved@${t.width} default/other unit/periods/translations`, JSON.stringify(await snapshot(t)) === JSON.stringify(t.baseline));
    } },
    { name: "validation-error", async run(t) {
      await input(t).fill("1.5"); await save(t).click();
      await t.page.getByText(/정수를 입력하세요/).waitFor();
      t.check(`invalid@${t.width} retained`, await input(t).inputValue() === "1.5");
      await t.shot("validation-error");
    } },
    { name: "save-failed", async run(t) {
      const pattern = `**/api/admin/artists/${t.fixture.a}/stage-identities`;
      await t.page.route(pattern, (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "QA 저장 실패 — 다시 시도하세요." }) }));
      try {
        await input(t).fill("2"); await save(t).click();
        await t.page.getByText("QA 저장 실패 — 다시 시도하세요.", { exact: true }).waitFor();
        t.check(`failed@${t.width} retained`, await input(t).inputValue() === "2");
        await t.shot("save-failed");
      } finally { await t.page.unroute(pattern); }
    } },
    { name: "duplicate-warning", async run(t) {
      await input(t, 0).fill("0"); await save(t, 0).click();
      await t.page.getByText(/같은 관계순이 있습니다/).waitFor();
      t.check(`tie@${t.width} default fallback`, JSON.stringify(await rowIds(t)) === JSON.stringify(t.fixture.ids));
      await t.shot("duplicate-warning");
    } },
    { name: "cleared", async run(t) {
      for (const index of [0, 1]) {
        await input(t, index).fill("");
        const response = t.page.waitForResponse(request(t));
        await save(t, index).click(); await response;
      }
      await t.open(edit(t.fixture.a));
      t.check(`clear@${t.width} default IDs`, JSON.stringify(await rowIds(t)) === JSON.stringify(t.fixture.ids));
      t.check(`clear@${t.width} baseline`, JSON.stringify(await snapshot(t)) === JSON.stringify(t.baseline));
      await t.shot("cleared");
    } },
  ],
  async keyboard(t) {
    await input(t).focus(); await t.page.keyboard.type("-1");
    await t.page.keyboard.press("Tab");
    t.check(`keyboard@${t.width} save focused`, await save(t).evaluate((button) => button === document.activeElement));
    await t.keyboardActivate(save(t), "relationship save");
    await t.page.getByText("관계순을 저장했습니다.", { exact: true }).waitFor();
    t.check(`keyboard@${t.width} stable focus`, await save(t).evaluate((button) => button === document.activeElement));
  },
};
export default scenario;
