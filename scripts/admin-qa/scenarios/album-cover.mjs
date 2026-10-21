// admin-qa scenario: the album cover editor on /admin/albums/<id>/edit.
// The reference scenario — copy it as the starting point for another
// image editor (series logo, event logo, …).
//
// Fixture: one NEW Album (slug `cover-qa-<ms>`, title TOKIMEKI Runners,
// an external Amazon cover URL). States that need a "concurrent" change
// or a specific starting cover write only this row, directly. The
// "empty" state views an existing album without a cover READ-ONLY.
//
// `--upload` adds one real upload (chromium, 1440 only) to the dev bucket
// under the server's R2_KEY_PREFIX; its ImageAsset row is deleted with the
// fixture, the R2 object stays (record its key with the QA evidence).
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const AMAZON = "https://m.media-amazon.com/images/I/61YKje84RHL._SL500_.jpg";
const OTHER = "https://m.media-amazon.com/images/I/61YKje84RHL._SL300_.jpg";
const BROKEN = "https://example.invalid/cover-qa/missing.jpg";
const API = (id) => `**/api/admin/albums/${id}/cover`;

const setCover = (t, url) => t.db.query(`update "Album" set "imageUrl" = $1 where id = $2`, [url, t.fixture.albumId]);
const getCover = async (t) =>
  (await t.db.query(`select "imageUrl" from "Album" where id = $1`, [t.fixture.albumId])).rows[0].imageUrl;
const editPath = (id) => `/admin/albums/${id}/edit`;

const badge = (t) => t.page.getByTestId("cover-current-badge");
const save = (t) => t.page.getByRole("button", { name: "표지 저장" });
const urlInput = (t) => t.page.getByLabel(/표지 이미지 URL/);
const uploadTab = (t) => t.page.getByRole("button", { name: "파일 업로드" });
const fileInput = (t) => t.page.getByLabel("표지 이미지 파일 선택");

const scenario = {
  name: "album-cover",
  ready: '[data-testid="album-cover-editor"]',
  container: '[data-testid="album-cover-editor"]',
  modes: {
    full: { states: [1440, 390], overflow: [320, 375, 430, 768, 1024], a11y: [1440, 390] },
    quick: { states: [390, 1440], overflow: [], a11y: [390] },
  },

  fixture: {
    tagPrefix: "cover",
    async create({ db, tag, outDir }) {
      const { rows } = await db.query(
        `insert into "Album"(slug, type, "originalTitle", "originalLanguage", "releaseDate", "labelName", "imageUrl")
         values ($1, 'single', 'TOKIMEKI Runners', 'ja', '2018-11-21', 'Lantis', $2) returning id`,
        [tag, AMAZON],
      );
      // An existing album without a cover, viewed read-only for "empty".
      const empty = await db.query(
        `select id from "Album" where "imageUrl" is null and slug not like '%-qa-%' and slug not like '%-itest-%'
         order by id limit 1`,
      );
      const png = await sharp({
        create: { width: 600, height: 600, channels: 4, background: { r: 120, g: 90, b: 200, alpha: 1 } },
      })
        .composite([
          {
            input: Buffer.from(
              `<svg width="600" height="600"><rect x="40" y="40" width="520" height="520" fill="none" stroke="white" stroke-width="12"/><text x="300" y="320" font-size="64" text-anchor="middle" fill="white" font-family="sans-serif">QA TEST</text></svg>`,
            ),
          },
        ])
        .png()
        .toBuffer();
      const pngPath = path.join(outDir, "qa-test-cover.png");
      fs.writeFileSync(pngPath, png);
      return { albumId: String(rows[0].id), emptyAlbumId: empty.rows[0] ? String(empty.rows[0].id) : null, pngPath };
    },
    async remove({ db, tag }) {
      // Delete by tag, not by the returned id, so a create that failed
      // halfway is cleaned up too. ImageAsset rows are the ones an
      // --upload run made for this album (object key …/album-cover/<id>/…).
      const ids = (await db.query(`select id from "Album" where slug = $1`, [tag])).rows.map((r) => String(r.id));
      for (const id of ids) {
        await db.query(`update "Album" set "imageUrl" = null where id = $1`, [id]);
        await db.query(`delete from "ImageAsset" where "objectKey" like $1`, [`%/album-cover/${id}/%`]);
        await db.query(`delete from "Album" where id = $1`, [id]);
      }
    },
    async remaining({ db, tag, fixture }) {
      const albums = (await db.query(`select count(*)::int n from "Album" where slug = $1`, [tag])).rows[0].n;
      const assets = fixture
        ? (await db.query(`select count(*)::int n from "ImageAsset" where "objectKey" like $1`, [`%/album-cover/${fixture.albumId}/%`])).rows[0].n
        : 0;
      return albums + assets;
    },
  },

  async openDefault(t) {
    await setCover(t, AMAZON);
    await t.open(editPath(t.fixture.albumId));
  },

  states: [
    {
      name: "default",
      async run(t) {
        await setCover(t, AMAZON);
        const referer = t.refererTo("https://m.media-amazon.com/");
        await t.open(editPath(t.fixture.albumId));
        await t.checkImgNoReferrer('[data-testid="cover-preview"] img', "default");
        // "unset" means no request reached the host at all — a FAIL, or
        // the no-Referer check would pass vacuously.
        const r = referer();
        t.check(`default@${t.width} external host requested`, r !== "unset");
        t.check(`default@${t.width} no Referer sent to external host`, r === "", r);
        t.check(`default@${t.width} badge`, /URL · Amazon/.test(await badge(t).innerText()));
        await t.shot("default");
      },
    },
    {
      name: "preview",
      async run(t) {
        let coverWrites = 0;
        t.page.on("request", (r) => {
          if (r.url().includes(`/api/admin/albums/${t.fixture.albumId}/cover`) && r.method() !== "GET") coverWrites++;
        });
        await uploadTab(t).click();
        await fileInput(t).setInputFiles(t.fixture.pngPath);
        await t.page.getByText("선택한 파일").waitFor();
        t.check(`preview@${t.width} selecting sends nothing`, coverWrites === 0);
        await t.shot("preview");
        await t.page.getByRole("button", { name: "선택 취소" }).click();
        t.check(`preview@${t.width} cancel sends nothing`, coverWrites === 0);
      },
    },
    {
      name: "unlink",
      async run(t) {
        await t.open(editPath(t.fixture.albumId));
        await t.page.getByRole("button", { name: "표지 연결 해제" }).click();
        await t.page.getByText("저장하면 현재 표지가 비어 있게 됩니다", { exact: false }).waitFor();
        await t.shot("unlink");
      },
    },
    {
      // Hold the PUT, then abort it: "saving" while held, "lost" (outcome
      // unknown) after, and the re-read confirms nothing changed.
      name: "saving-lost",
      async run(t) {
        await t.open(editPath(t.fixture.albumId));
        let release;
        const held = new Promise((r) => (release = r));
        await t.page.route(API(t.fixture.albumId), async (route) => {
          if (route.request().method() === "PUT") {
            await held;
            return route.abort("failed");
          }
          return route.continue();
        });
        await urlInput(t).fill(OTHER);
        await save(t).click();
        await t.page.getByText("저장 중입니다").waitFor();
        t.check(`saving@${t.width} controls locked`, await uploadTab(t).isDisabled());
        await t.shot("saving");
        release();
        await t.page.getByText("저장 결과를 확인하지 못했습니다").waitFor();
        t.check(`lost@${t.width} save locked`, await t.page.getByRole("button", { name: /표지 저장|저장 중/ }).isDisabled());
        await t.shot("lost");
        await t.page.unroute(API(t.fixture.albumId));
        await t.page.getByRole("button", { name: "현재 상태 확인" }).click();
        await t.page.getByText("현재 값은 변경되지 않았습니다").waitFor();
        t.check(`lost@${t.width} re-read: unchanged`, (await getCover(t)) === AMAZON);
        await t.shot("lost-checked");
      },
    },
    {
      // A known not_saved answer, then a real retry that saves.
      name: "failure-retry",
      async run(t) {
        await t.open(editPath(t.fixture.albumId));
        await t.page.route(API(t.fixture.albumId), (route) =>
          route.request().method() === "PUT"
            ? route.fulfill({
                status: 500,
                contentType: "application/json",
                body: JSON.stringify({
                  error: "not_saved",
                  outcome: "not_saved",
                  message: "데이터베이스 저장에 실패했습니다. 기존 이미지는 그대로입니다. 잠시 후 다시 시도해 주세요.",
                }),
              })
            : route.continue(),
        );
        await urlInput(t).fill(OTHER);
        await save(t).click();
        await t.page.getByText("저장하지 못했습니다").waitFor();
        await t.shot("failure");
        await t.page.unroute(API(t.fixture.albumId));
        await t.page.getByRole("button", { name: "다시 저장" }).click();
        await t.page.getByText("저장되었습니다").waitFor();
        t.check(`failure@${t.width} retry saves`, (await getCover(t)) === OTHER);
        await t.shot("success-url");
      },
    },
    {
      // A real concurrent change: the row moves under the open editor.
      name: "conflict",
      async run(t) {
        await setCover(t, AMAZON);
        await t.open(editPath(t.fixture.albumId));
        await setCover(t, OTHER);
        await t.page.getByRole("button", { name: "표지 연결 해제" }).click();
        await save(t).click();
        await t.page.getByText("다른 곳에서 표지가 변경되었습니다").waitFor();
        t.check(`conflict@${t.width} server value kept`, (await getCover(t)) === OTHER);
        await t.shot("conflict");
        await t.page.getByRole("button", { name: "최신 값 불러오기 · 이미지 초안 폐기" }).click();
        await t.page.getByText("최신 값을 불러왔습니다").waitFor();
        await t.shot("refreshed");
      },
    },
    {
      name: "broken",
      async run(t) {
        await setCover(t, BROKEN);
        await t.open(editPath(t.fixture.albumId));
        await t.page.getByText("표지를 불러올 수 없습니다").waitFor();
        t.check(`broken@${t.width} URL kept`, (await urlInput(t).inputValue()) === BROKEN);
        await t.shot("broken");
      },
    },
    {
      name: "empty",
      async run(t) {
        if (!t.fixture.emptyAlbumId) {
          t.check(`empty@${t.width} an existing album without a cover exists`, false);
          return;
        }
        await t.open(editPath(t.fixture.emptyAlbumId));
        t.check(`empty@${t.width} existing album shows no cover`, /표지 없음/.test(await badge(t).innerText()));
        await t.shot("empty");
      },
    },
    {
      name: "upload",
      when: (t) => t.opts.upload && t.browserName === "chromium" && t.width === 1440,
      async run(t) {
        await setCover(t, AMAZON);
        await t.open(editPath(t.fixture.albumId));
        await uploadTab(t).click();
        await fileInput(t).setInputFiles(t.fixture.pngPath);
        await t.page.getByPlaceholder("https://…").fill("https://example.com/qa-source");
        await t.page.getByPlaceholder("출처·사용 검토 내용을 기록하세요").fill("QA 테스트 업로드 · 공식 표지 아님");
        await save(t).click();
        await t.page.getByText("저장되었습니다").waitFor({ timeout: 30000 });
        const managed = await getCover(t);
        t.check(`upload@${t.width} assigns managed URL`, managed && managed.startsWith(t.env.R2_PUBLIC_BASE_URL), managed);
        const r2Badge = await t.page
          .waitForFunction(
            () => /업로드 이미지 · R2/.test(document.querySelector('[data-testid="cover-current-badge"]')?.textContent ?? ""),
            null,
            { timeout: 10000 },
          )
          .then(() => true, () => false);
        t.check(`upload@${t.width} badge R2`, r2Badge);
        await t.shot("success-upload");
        await t.page.getByRole("button", { name: "URL 입력" }).click();
        const provenance = await t.page
          .getByText(/관리 업로드 · 600×600/)
          .waitFor({ timeout: 10000 })
          .then(() => true, () => false);
        t.check(`upload@${t.width} provenance by exact URL`, provenance);
        await t.shot("success-upload-provenance");
        fs.writeFileSync(path.join(t.outDir, "uploaded-url.txt"), managed);
        // The public album page renders the new cover (the save expired its cache).
        for (const [loc, w] of [["ko", 1440], ["ja", 390], ["en", 390]]) {
          const p2 = await t.ctx.newPage();
          await p2.setViewportSize({ width: w, height: 900 });
          const slug = (await t.db.query(`select slug from "Album" where id = $1`, [t.fixture.albumId])).rows[0].slug;
          await p2.goto(`${t.base}/${loc}/albums/${t.fixture.albumId}/${slug}`, { waitUntil: "networkidle" });
          const ok = await p2.evaluate((u) => {
            const img = [...document.images].find((i) => i.src === u);
            return img ? { found: true, w: img.naturalWidth, rp: img.referrerPolicy } : { found: false };
          }, managed);
          t.check(`public ${loc}@${w} renders uploaded cover`, ok.found && ok.w > 0, JSON.stringify(ok));
          await t.capture(p2, `public-${loc}`, w);
          await p2.close();
        }
        // Upload → URL replaces it; the asset row is retained.
        await t.open(editPath(t.fixture.albumId));
        await t.page.getByRole("button", { name: "URL 입력" }).click();
        await urlInput(t).fill(AMAZON);
        await save(t).click();
        await t.page.getByText("저장되었습니다").waitFor();
        t.check(`upload→URL@${t.width}`, (await getCover(t)) === AMAZON);
        const kept = (await t.db.query(`select count(*)::int n from "ImageAsset" where "publicUrl" = $1`, [managed])).rows[0].n;
        t.check(`upload→URL@${t.width} asset row retained`, kept === 1);
      },
    },
  ],

  // Page-specific keyboard step; the harness adds named-controls and
  // reduced-motion checks over `container` afterwards.
  async keyboard(t) {
    await t.keyboardActivate(uploadTab(t), "upload tab");
    t.check(`kbd@${t.width} Enter switches tab`, await fileInput(t).isVisible());
  },
};

export default scenario;
