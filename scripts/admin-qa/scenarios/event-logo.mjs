// admin-qa scenario: the event logo override card on /admin/events/<id>/edit.
// Copied from album-cover and adapted to the logo card (inherit / custom /
// typography, upload only for custom).
//
// Fixture (all NEW rows, tag `event-logo-qa-<ms>`): one EventSeries (ko
// translation) and one Event under it, plus three ImageAsset rows:
//   series / event — publicUrl = the dev bucket's retained smoke object
//                    (R2 handoff 08) with a distinct query string, so the
//                    preview renders a real image without writing to R2;
//   broken         — an unreachable https URL (image-failure state).
// States write only these rows. `--upload` adds one real upload (chromium,
// 1440 only) to the dev bucket under the server's R2_KEY_PREFIX; its
// ImageAsset row is deleted with the fixture, the R2 object stays (its key
// is written to uploaded-url.txt for the QA evidence).
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const SMOKE_KEY = "test/smoke/6e466128-88e9-4d08-825a-bd6d9d23b5f1.png";
const editPath = (id) => `/admin/events/${id}/edit`;
const API = (id) => `**/api/admin/events/${id}/logo`;

const setEvent = (t, mode, assetId = null) =>
  t.db.query(`update "Event" set "logoMode" = $1, "logoAssetId" = $2 where id = $3`, [mode, assetId, t.fixture.eventId]);
const setSeries = (t, mode, assetId = null) =>
  t.db.query(`update "EventSeries" set "logoMode" = $1, "logoAssetId" = $2 where id = $3`, [mode, assetId, t.fixture.seriesId]);
const getEvent = async (t) =>
  (await t.db.query(`select "logoMode" m, "logoAssetId" a, "posterUrl" p from "Event" where id = $1`, [t.fixture.eventId])).rows[0];
const reset = async (t) => {
  await setEvent(t, "inherit");
  await setSeries(t, "inherit");
};

const card = (t) => t.page.getByTestId("event-logo-section");
// A string name matches as a substring (the label also holds the description).
const radio = (t, name) => card(t).getByRole("radio", { name });
const save = (t) => card(t).getByRole("button", { name: /^(저장|저장 중…)$/ });
const fileInput = (t) => card(t).getByLabel("이미지 파일 선택");
const preview = (t) => t.page.getByTestId("logo-preview");

const scenario = {
  name: "event-logo",
  ready: '[data-testid="event-logo-section"]',
  container: '[data-testid="event-logo-section"]',
  modes: {
    full: { states: [1440, 390], overflow: [320, 375, 430, 768, 1024], a11y: [1440, 390] },
    quick: { states: [390, 1440], overflow: [], a11y: [390] },
  },

  fixture: {
    tagPrefix: "event-logo",
    async create({ db, tag, outDir, env }) {
      const base = (env.R2_PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");
      if (!/^https:\/\//.test(base)) throw new Error("R2_PUBLIC_BASE_URL (https) is required for the preview images");
      const series = await db.query(
        `insert into "EventSeries"(slug, type, "originalName", "originalShortName", "originalLanguage")
         values ($1, 'concert_tour', 'ラブライブ！蓮ノ空女学院スクールアイドルクラブ 6th Live Dream ～Bloom Garden Party～ [QA]', '蓮ノ空 6th Live BGP [QA]', 'ja')
         returning id`,
        [tag],
      );
      const seriesId = String(series.rows[0].id);
      await db.query(
        `insert into "EventSeriesTranslation"(id, "eventSeriesId", locale, name) values (gen_random_uuid()::text, $1, 'ko', $2)`,
        [seriesId, "하스노소라 6th Live BGP [QA]"],
      );
      const event = await db.query(
        `insert into "Event"(slug, type, "eventSeriesId", "originalName", "originalShortName", "originalVenue", "originalCity",
                             date, "startTime", "posterUrl", "originalLanguage")
         values ($1, 'concert', $2, 'Bloom Stage／福岡公演 Day.1 [QA]', 'Bloom Stage／福岡公演 Day.1 [QA]', 'マリンメッセ福岡B館', '福岡',
                 '2026-05-02', '2026-05-02 08:00:00', $3, 'ja')
         returning id`,
        [tag, seriesId, `https://posters.test.invalid/${tag}/poster.jpg`],
      );
      const eventId = String(event.rows[0].id);
      const asset = async (name, url, w, h) =>
        String(
          (
            await db.query(
              `insert into "ImageAsset"(id, "objectKey", "publicUrl", "mimeType", "byteSize", width, height, "usageNote")
               values (gen_random_uuid()::text, $1, $2, 'image/png', 104, $3, $4, 'QA fixture · 공식 로고 아님') returning id`,
              [`qa/${tag}/${name}.png`, url, w, h],
            )
          ).rows[0].id,
        );
      const seriesAsset = await asset("series", `${base}/${SMOKE_KEY}?qa=${tag}-series`, 16, 16);
      const eventAsset = await asset("event", `${base}/${SMOKE_KEY}?qa=${tag}-event`, 16, 16);
      const brokenAsset = await asset("broken", `https://example.invalid/${tag}/missing.png`, 400, 100);
      const png = await sharp({
        create: { width: 800, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
      })
        .composite([
          {
            input: Buffer.from(
              `<svg width="800" height="200"><rect x="8" y="8" width="784" height="184" rx="24" fill="none" stroke="#7d5dd1" stroke-width="8"/><text x="400" y="122" font-size="72" text-anchor="middle" fill="#413554" font-family="sans-serif">QA EVENT LOGO</text></svg>`,
            ),
          },
        ])
        .png()
        .toBuffer();
      const pngPath = path.join(outDir, "qa-test-event-logo.png");
      fs.writeFileSync(pngPath, png);
      return { seriesId, eventId, seriesAsset, eventAsset, brokenAsset, pngPath };
    },
    async remove({ db, tag }) {
      // By tag, so a create that failed halfway is cleaned up too.
      const events = (await db.query(`select id from "Event" where slug = $1`, [tag])).rows.map((r) => String(r.id));
      const series = (await db.query(`select id from "EventSeries" where slug = $1`, [tag])).rows.map((r) => String(r.id));
      for (const id of events) {
        await db.query(`update "Event" set "logoMode" = 'inherit', "logoAssetId" = null where id = $1`, [id]);
      }
      for (const id of series) {
        await db.query(`update "EventSeries" set "logoMode" = 'inherit', "logoAssetId" = null where id = $1`, [id]);
      }
      for (const id of events) {
        await db.query(`delete from "ImageAsset" where "objectKey" like $1`, [`%/event-logo/${id}/%`]);
        await db.query(`delete from "EventTranslation" where "eventId" = $1`, [id]);
        await db.query(`delete from "Event" where id = $1`, [id]);
      }
      for (const id of series) {
        await db.query(`delete from "EventSeriesTranslation" where "eventSeriesId" = $1`, [id]);
        await db.query(`delete from "EventSeries" where id = $1`, [id]);
      }
      await db.query(`delete from "ImageAsset" where "objectKey" like $1`, [`qa/${tag}/%`]);
    },
    async remaining({ db, tag, fixture }) {
      const q = async (sql, args) => (await db.query(sql, args)).rows[0].n;
      return (
        (await q(`select count(*)::int n from "Event" where slug = $1`, [tag])) +
        (await q(`select count(*)::int n from "EventSeries" where slug = $1`, [tag])) +
        (await q(`select count(*)::int n from "ImageAsset" where "objectKey" like $1`, [`qa/${tag}/%`])) +
        (fixture
          ? await q(`select count(*)::int n from "ImageAsset" where "objectKey" like $1`, [`%/event-logo/${fixture.eventId}/%`])
          : 0)
      );
    },
  },

  async openDefault(t) {
    await reset(t);
    await t.open(editPath(t.fixture.eventId));
  },

  states: [
    {
      name: "default",
      async run(t) {
        await reset(t);
        await t.open(editPath(t.fixture.eventId));
        t.check(`default@${t.width} inherit checked`, await radio(t, "시리즈에서 상속").isChecked());
        t.check(`default@${t.width} typography preview`, (await preview(t).getAttribute("data-state")) === "typography");
        t.check(
          `default@${t.width} explains the series path`,
          (await card(t).innerText()).includes("공연 → 하스노소라 6th Live BGP [QA] → 상속할 로고 없음"),
        );
        await t.shot("default");
      },
    },
    {
      name: "preview",
      async run(t) {
        let writes = 0;
        t.page.on("request", (r) => {
          if (r.url().includes(`/api/admin/events/${t.fixture.eventId}/logo`) && r.method() !== "GET") writes++;
        });
        await radio(t, "직접 지정").check();
        await fileInput(t).setInputFiles(t.fixture.pngPath);
        await card(t).getByText("선택한 파일").waitFor();
        t.check(`preview@${t.width} selecting sends nothing`, writes === 0);
        t.check(`preview@${t.width} local preview shown`, (await preview(t).getAttribute("data-state")) === "logo");
        await t.shot("preview");
        await card(t).getByRole("button", { name: "선택 취소" }).click();
        t.check(`preview@${t.width} cancel sends nothing`, writes === 0);
      },
    },
    {
      name: "inherited",
      async run(t) {
        await setEvent(t, "inherit");
        await setSeries(t, "custom", t.fixture.seriesAsset);
        await t.open(editPath(t.fixture.eventId));
        await t.checkImgNoReferrer('[data-testid="logo-preview"] img', "inherited");
        t.check(
          `inherited@${t.width} names the series`,
          (await card(t).innerText()).includes("시리즈 「하스노소라 6th Live BGP [QA]」의 로고를 사용합니다"),
        );
        await t.shot("inherited");
      },
    },
    {
      name: "custom",
      async run(t) {
        await setSeries(t, "typography");
        await setEvent(t, "custom", t.fixture.eventAsset);
        await t.open(editPath(t.fixture.eventId));
        await t.checkImgNoReferrer('[data-testid="logo-preview"] img', "custom");
        t.check(`custom@${t.width} custom checked`, await radio(t, "직접 지정").isChecked());
        await t.shot("custom");
      },
    },
    {
      name: "unlink",
      async run(t) {
        await setSeries(t, "custom", t.fixture.seriesAsset);
        await setEvent(t, "custom", t.fixture.eventAsset);
        await t.open(editPath(t.fixture.eventId));
        await card(t).getByRole("button", { name: "직접 지정 해제 · 상속으로" }).click();
        t.check(`unlink@${t.width} draft is inherit`, await radio(t, "시리즈에서 상속").isChecked());
        await t.shot("unlink");
        await save(t).click();
        await card(t).getByText("저장되었습니다").waitFor();
        const row = await getEvent(t);
        t.check(`unlink@${t.width} saved inherit, poster kept`, row.m === "inherit" && row.a === null && row.p?.includes("poster.jpg"));
        t.check(`unlink@${t.width} stays on the edit page`, t.page.url().includes(editPath(t.fixture.eventId)));
        await t.shot("unlink-saved");
      },
    },
    {
      name: "typography",
      async run(t) {
        await setSeries(t, "custom", t.fixture.seriesAsset);
        await setEvent(t, "inherit");
        await t.open(editPath(t.fixture.eventId));
        await radio(t, "타이포그래피만").check();
        t.check(`typography@${t.width} preview typography`, (await preview(t).getAttribute("data-state")) === "typography");
        await t.shot("typography");
      },
    },
    {
      // Hold the PATCH, then abort it: "saving" while held, "lost" after,
      // and the read-only check finds nothing changed.
      name: "saving-lost",
      async run(t) {
        await reset(t);
        await t.open(editPath(t.fixture.eventId));
        let release;
        const held = new Promise((r) => (release = r));
        await t.page.route(API(t.fixture.eventId), async (route) => {
          if (route.request().method() === "PATCH") {
            await held;
            return route.abort("failed");
          }
          return route.continue();
        });
        await radio(t, "타이포그래피만").check();
        await save(t).click();
        await card(t).getByText("저장 중입니다").waitFor();
        t.check(`saving@${t.width} modes locked`, await radio(t, "시리즈에서 상속").isDisabled());
        await t.shot("saving");
        release();
        await card(t).getByText("저장 결과를 확인하지 못했습니다").waitFor();
        t.check(`lost@${t.width} save locked`, await save(t).isDisabled());
        await t.shot("lost");
        await t.page.unroute(API(t.fixture.eventId));
        await card(t).getByRole("button", { name: "현재 상태 확인" }).click();
        await card(t).getByText("현재 값은 아직 바뀌지 않았습니다").waitFor();
        t.check(`lost@${t.width} re-read: unchanged`, (await getEvent(t)).m === "inherit");
        await t.shot("lost-checked");
      },
    },
    {
      name: "failure-retry",
      async run(t) {
        await reset(t);
        await t.open(editPath(t.fixture.eventId));
        await t.page.route(API(t.fixture.eventId), (route) =>
          route.request().method() === "PATCH"
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
        await radio(t, "타이포그래피만").check();
        await save(t).click();
        await card(t).getByText("저장하지 못했습니다").waitFor();
        t.check(`failure@${t.width} value kept`, (await getEvent(t)).m === "inherit");
        await t.shot("failure");
        await t.page.unroute(API(t.fixture.eventId));
        await card(t).getByRole("button", { name: "다시 저장" }).click();
        await card(t).getByText("저장되었습니다").waitFor();
        t.check(`failure@${t.width} retry saves`, (await getEvent(t)).m === "typography");
        await t.shot("success");
      },
    },
    {
      // A real concurrent change: the row moves under the open card.
      name: "conflict",
      async run(t) {
        await reset(t);
        await t.open(editPath(t.fixture.eventId));
        await setEvent(t, "custom", t.fixture.eventAsset);
        await radio(t, "타이포그래피만").check();
        await save(t).click();
        await card(t).getByText("다른 곳에서 이미지 설정이 변경되었습니다").waitFor();
        t.check(`conflict@${t.width} server value kept`, (await getEvent(t)).a === t.fixture.eventAsset);
        await t.shot("conflict");
        await card(t).getByRole("button", { name: "최신 값 불러오기 · 이미지 초안 폐기" }).click();
        await card(t).getByText("최신 값을 불러왔습니다").waitFor();
        t.check(`conflict@${t.width} reload shows the newer custom`, await radio(t, "직접 지정").isChecked());
        await t.shot("refreshed");
      },
    },
    {
      name: "broken",
      async run(t) {
        await setSeries(t, "custom", t.fixture.seriesAsset);
        await setEvent(t, "custom", t.fixture.brokenAsset);
        await t.open(editPath(t.fixture.eventId));
        await card(t).getByText("선택된 로고를 불러올 수 없어 제목을 표시합니다", { exact: false }).waitFor();
        t.check(`broken@${t.width} typography, no series-logo substitute`, (await preview(t).getAttribute("data-state")) === "typography");
        await t.shot("broken");
      },
    },
    {
      name: "upload",
      when: (t) => t.opts.upload && t.browserName === "chromium" && t.width === 1440,
      async run(t) {
        await reset(t);
        await t.open(editPath(t.fixture.eventId));
        await radio(t, "직접 지정").check();
        await fileInput(t).setInputFiles(t.fixture.pngPath);
        await card(t).getByPlaceholder("https://…").fill("https://example.com/qa-source");
        await card(t).getByPlaceholder("출처·사용 검토 내용을 기록하세요").fill("QA 테스트 업로드 · 공식 로고 아님");
        await save(t).click();
        await card(t).getByText("저장되었습니다").waitFor({ timeout: 30000 });
        const row = await getEvent(t);
        const asset = row.a
          ? (await t.db.query(`select "publicUrl" u, "objectKey" k, width w, height h from "ImageAsset" where id = $1`, [row.a])).rows[0]
          : null;
        t.check(`upload@${t.width} custom + managed URL`, row.m === "custom" && asset?.u?.startsWith(t.env.R2_PUBLIC_BASE_URL), asset?.u);
        t.check(`upload@${t.width} dimensions kept`, asset?.w === 800 && asset?.h === 200, `${asset?.w}x${asset?.h}`);
        await t.checkImgNoReferrer('[data-testid="logo-preview"] img', "upload");
        await t.shot("success-upload");
        fs.writeFileSync(path.join(t.outDir, "uploaded-url.txt"), `${asset?.k ?? ""}\n${asset?.u ?? ""}\n`);
        // Unlink: the asset row stays.
        await card(t).getByRole("button", { name: "직접 지정 해제 · 상속으로" }).click();
        await save(t).click();
        await card(t).getByText("저장되었습니다").waitFor();
        const kept = (await t.db.query(`select count(*)::int n from "ImageAsset" where id = $1`, [row.a])).rows[0].n;
        t.check(`upload→unlink@${t.width} asset row retained`, kept === 1 && (await getEvent(t)).m === "inherit");
      },
    },
  ],

  // Radios are a native group: arrow keys move and select.
  async keyboard(t) {
    await t.page.keyboard.press("Shift");
    await radio(t, "시리즈에서 상속").focus();
    const ring = await t.page.evaluate(() => {
      const s = getComputedStyle(document.activeElement);
      return { outline: s.outlineStyle, shadow: s.boxShadow };
    });
    t.check(`kbd radio@${t.width} focus indicator`, ring.outline !== "none" || ring.shadow !== "none", JSON.stringify(ring));
    await t.page.keyboard.press("ArrowDown");
    t.check(`kbd@${t.width} ArrowDown selects 직접 지정`, await radio(t, "직접 지정").isChecked());
    t.check(`kbd@${t.width} file input appears`, await fileInput(t).isVisible());
    await t.keyboardActivate(card(t).getByRole("button", { name: "취소" }), "cancel");
    t.check(`kbd@${t.width} Enter on 취소 restores inherit`, await radio(t, "시리즈에서 상속").isChecked());
  },
};

export default scenario;
