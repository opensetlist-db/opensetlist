import { describe, it, expect } from "vitest";
import en from "../../../messages/en.json";
import ja from "../../../messages/ja.json";
import ko from "../../../messages/ko.json";

/**
 * Event terminology guard for the message catalogs.
 *
 * Design mockups carry illustrative copy; approving a screen does not
 * approve its wording. Without a guard, mockup copy can rename the Event
 * entity (Events → Concerts, イベント → 公演, 이벤트 → 공연) or the Japanese
 * setlist spelling (セットリスト → セトリ) unnoticed. The owner-approved
 * rule set lives in the wiki spec `output/redesign-event-terms/spec.md`:
 *
 *   - en: the entity is "event(s)", never "concert(s)" / "show(s)";
 *     copy touched by the rollback is sentence case.
 *   - ja / ko: production precedent first (イベント / 이벤트 for general
 *     event browsing, 公演 / 공연 where production already says so).
 *   - ja セットリスト (not セトリ), ko 세트리스트 (not 셋리스트).
 *
 * Two checks keep that from drifting again:
 *
 *   1. DECIDED pins every key of the spec's decision tables (the reverted
 *      keys, the new redesign keys and the "unchanged on purpose" keys) in
 *      all three locales. Changing one of these values is meant to be a
 *      deliberate edit of this table, not a side effect of new mockup copy.
 *   2. The forbidden-term scan walks EVERY value of every catalog. A match
 *      passes only when ALLOWED lists that exact locale + key + value with a
 *      reason, so widening the allow-list is a visible decision too.
 */

type Locale = "en" | "ja" | "ko";

const LOCALES: Locale[] = ["en", "ja", "ko"];

function flatten(node: unknown, prefix = "", out: Record<string, string> = {}) {
  if (typeof node === "string") {
    out[prefix] = node;
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      flatten(v, prefix ? `${prefix}.${k}` : k, out);
    }
  }
  return out;
}

const FLAT: Record<Locale, Record<string, string>> = {
  en: flatten(en),
  ja: flatten(ja),
  ko: flatten(ko),
};

// English: "concert(s)" / "show(s)" as whole words, any case. The regex
// cannot tell the noun from the verb ("Show more"), so verb uses are listed
// in ALLOWED like every other exception rather than special-cased here.
const FORBIDDEN: Record<Locale, RegExp> = {
  en: /\b(?:concerts?|shows?)\b/i,
  ja: /セトリ/,
  ko: /셋리스트/,
};

const DECIDED: Record<string, Record<Locale, string>> = {
  "Header.events": {
    en: "Events",
    ja: "イベント",
    ko: "이벤트",
  },
  "Home.upcomingTitle": {
    en: "Upcoming events",
    ja: "今後の公演",
    ko: "다가오는 공연",
  },
  "Home.recentTitle": {
    en: "Recent events",
    ja: "最近の公演",
    ko: "최근 공연",
  },
  "Home.wishOpen": {
    en: "Setlist prediction available",
    ja: "セットリスト予想受付中",
    ko: "세트리스트 예상 가능",
  },
  "Event.filter.ongoing": {
    en: "Live now",
    ja: "開催中",
    ko: "진행 중",
  },
  "Hero.heading": {
    en: "The live story we keep together",
    ja: "<line>みんなでつなぐ、</line><line>ライブの物語</line>",
    ko: "모두가 이어가는 공연의 이야기",
  },
  "Home.allConcerts": {
    en: "All events",
    ja: "すべてのイベント",
    ko: "모든 이벤트",
  },
  "Home.railHint": {
    en: "Scroll sideways to explore upcoming events →",
    ja: "横にスクロールして、次の公演へ →",
    ko: "옆으로 넘겨 다음 공연을 만나보세요 →",
  },
  "Home.recentNote": {
    en: "Events held in the last 30 days with songs in their setlists.",
    ja: "最近30日間に開催され、曲が登録されている公演です。",
    ko: "최근 30일 동안 열린 공연 중 세트리스트가 있는 공연입니다.",
  },
  "Home.archiveTitle": {
    en: "From the setlist archive",
    ja: "過去のセットリストから",
    ko: "지난 세트리스트에서",
  },
  "Home.archiveNote": {
    en: "No qualifying setlists in the last 30 days. Explore earlier events.",
    ja: "最近30日間の公演にセットリストがないため、以前の公演を紹介します。",
    ko: "최근 30일 공연의 세트리스트가 없어, 이전 공연을 보여드립니다.",
  },
  "Home.emptyUpcoming": {
    en: "There are no upcoming events listed yet.",
    ja: "現在、掲載されている開催予定の公演はありません。",
    ko: "현재 등록된 예정 공연이 없습니다.",
  },
  "Home.emptyPast": {
    en: "No setlists with songs have been registered yet.",
    ja: "まだ曲が登録されたセットリストはありません。",
    ko: "아직 곡이 등록된 세트리스트가 없습니다.",
  },
  "Home.browse": {
    en: "Explore events",
    ja: "イベントを探す",
    ko: "이벤트 찾아보기",
  },
  "Home.setlistSongs": {
    en: "{count, plural, other {#-song setlist}}",
    ja: "{count, plural, other {#曲のセットリスト}}",
    ko: "{count, plural, other {#곡의 세트리스트}}",
  },
  "Home.setlistWaiting": {
    en: "Waiting for setlist updates",
    ja: "セットリストの更新を待っています",
    ko: "세트리스트 업데이트를 기다리고 있어요",
  },
  "Home.viewSetlist": {
    en: "View setlist",
    ja: "セットリストを見る",
    ko: "세트리스트 보기",
  },
  "Home.pastLink": {
    en: "Past setlists",
    ja: "過去のセットリスト",
    ko: "지난 세트리스트",
  },
  "Artist.viewAllHistory": {
    en: "View all event history",
    ja: "公演履歴をすべて見る",
    ko: "공연 이력 전체 보기",
  },
  "Member.viewAllHistory": {
    en: "View all event history",
    ja: "公演履歴をすべて見る",
    ko: "공연 이력 전체 보기",
  },
  "Artist.historyColumns.event": {
    en: "Event",
    ja: "公演",
    ko: "공연",
  },
  "EventDetail.infoTitle": {
    en: "Event info",
    ja: "イベント情報",
    ko: "이벤트 정보",
  },
  "EventDetail.factDate": {
    en: "Date",
    ja: "日付",
    ko: "날짜",
  },
  "EventDetail.factStart": {
    en: "Start",
    ja: "開始",
    ko: "시작",
  },
  "EventDetail.cancelledBody": {
    en: "This event is cancelled. Song wishes and predictions cannot be saved or edited.",
    ja: "この公演は中止です。聴きたい曲・予想曲の保存や編集はできません。",
    ko: "취소된 공연입니다. 희망곡·예상곡을 새로 저장하거나 수정할 수 없어요.",
  },
  "EventList.eyebrow": {
    en: "EVENTS & SETLISTS",
    ja: "EVENTS & SETLISTS",
    ko: "EVENTS & SETLISTS",
  },
  "EventList.title": {
    en: "Events",
    ja: "イベント一覧",
    ko: "이벤트 목록",
  },
  "EventList.subtitle": {
    en: "Find an event. Explore the live archive.",
    ja: "公演を見つけて、ライブの記録をたどる。",
    ko: "공연을 찾고, 라이브의 기록을 만나보세요.",
  },
  "EventList.filterLabel": {
    en: "Filter events",
    ja: "イベントの絞り込み",
    ko: "이벤트 필터",
  },
  "EventList.activeHeading": {
    en: "Live & upcoming events",
    ja: "開催中・これからのイベント",
    ko: "진행 중·예정 이벤트",
  },
  "EventList.pastHeading": {
    en: "Past events",
    ja: "過去のイベント",
    ko: "지난 이벤트",
  },
  "EventList.eventCount": {
    en: "{count, plural, one {# event} other {# events}}",
    ja: "{count, plural, other {# 公演}}",
    ko: "{count, plural, other {# 공연}}",
  },
  "EventList.viewAll": {
    en: "View all events",
    ja: "すべてのイベントを見る",
    ko: "전체 이벤트 보기",
  },
  "ShareCard.notePrediction": {
    en: "My picks for this event.",
    ja: "この公演を楽しみに選んだ、私の予想です。",
    ko: "이 공연을 기다리며 골라 본 나만의 예상입니다.",
  },
  "ShareCard.orderActual": {
    en: "Actual song order",
    ja: "実際の曲順",
    ko: "실제 곡 순서",
  },
  "Header.searchPlaceholder": {
    en: "Search events, artists, songs, albums",
    ja: "イベント・アーティスト・曲・アルバムを検索",
    ko: "이벤트·아티스트·곡·앨범 검색",
  },
  "Search.placeholder": {
    en: "Search events, artists, songs, albums",
    ja: "イベント・アーティスト・曲・アルバムを検索",
    ko: "이벤트·아티스트·곡·앨범 검색",
  },
  "Search.subtitle": {
    en: "Search events, artists, albums and songs",
    ja: "イベント、アーティスト、アルバム、曲を検索",
    ko: "이벤트, 아티스트, 앨범, 곡 검색",
  },
  "Search.events": {
    en: "Events",
    ja: "イベント",
    ko: "이벤트",
  },
  "Search.emptyBody": {
    en: "Enter an event, artist, song or album name to get started.",
    ja: "イベント名、アーティスト名、曲名、アルバム名から探せます。",
    ko: "이벤트명, 아티스트명, 곡명, 앨범명으로 찾을 수 있어요.",
  },
  "Hero.browse": {
    en: "Explore events",
    ja: "イベントを探す",
    ko: "이벤트 찾아보기",
  },
  "Hero.lead": {
    en: "Find an event. Revisit a setlist. Keep the memories together.",
    ja: "公演を見つけて、セットリストをたどる。ライブの記録を、みんなで。",
    ko: "공연을 찾고, 세트리스트를 만나세요. 함께 쌓아가는 라이브의 기록.",
  },
  "Hero.pastSetlists": {
    en: "Past setlists",
    ja: "過去のセットリストを見る",
    ko: "지난 세트리스트",
  },
  "Hero.caption": {
    en: "Fictional live music scene",
    ja: "架空のライブ会場イメージ",
    ko: "가상의 공연장 이미지",
  },
  "Home.liveTitle": {
    en: "Live now",
    ja: "いま開催中",
    ko: "지금 공연 중",
  },
  "Home.liveBadge": {
    en: "Live now",
    ja: "開催中",
    ko: "공연 중",
  },
  "Home.scheduled": {
    en: "Upcoming · {label}",
    ja: "開催予定 · {label}",
    ko: "공연 예정 · {label}",
  },
  "EventDetail.cancelledTitle": {
    en: "Cancelled",
    ja: "開催中止",
    ko: "공연 취소",
  },
  "EventList.empty": {
    en: "No events match",
    ja: "該当する公演がありません",
    ko: "해당하는 공연이 없어요",
  },
};

const VERB_SHOW = 'verb "show" (display), not the Event entity';
const MAIN_OUT_OF_SCOPE =
  "existing production (main) copy the rollback leaves untouched; out of scope per spec";

// Every allowed match, by exact value. If one of these values is edited,
// the scan stops matching it here and the new wording has to be judged
// again (and this entry updated or removed).
const ALLOWED: { locale: Locale; key: string; value: string; reason: string }[] = [
  // Preserved exceptions named in the spec.
  {
    locale: "ja",
    key: "Meta.eventTitle",
    value: "{name} セットリスト・セトリ | OpenSetlist",
    reason: "production SEO title keeps the セトリ keyword for search coverage",
  },
  {
    locale: "ja",
    key: "Event.predictOpensAt",
    value: "予想セトリは{date} {time}（{zone}）から投票できます。",
    reason: "production prediction-opens notice, preserved as is",
  },
  {
    locale: "en",
    key: "ShareCard.shareTextLive",
    value: "Show in progress — {matched} of {total} songs hit so far ({percentage}%)",
    reason: "production value the redesign reuses unchanged",
  },

  // The verb "show".
  { locale: "en", key: "Artist.noArtists", value: "No artists to show", reason: VERB_SHOW },
  { locale: "en", key: "Artist.showOtherUnits", value: "Show other units ({count})", reason: VERB_SHOW },
  { locale: "en", key: "Album.noAlbums", value: "No albums to show", reason: VERB_SHOW },
  {
    locale: "en",
    key: "Album.bonus.showEnded",
    value: "{count, plural, one {Show # ended store} other {Show # ended stores}}",
    reason: VERB_SHOW,
  },
  { locale: "en", key: "Album.events.empty", value: "No related events to show.", reason: VERB_SHOW },
  { locale: "en", key: "Event.noEvents", value: "No events to show", reason: VERB_SHOW },
  { locale: "en", key: "Predict.picker.emptyCatalog", value: "No songs to show", reason: VERB_SHOW },
  {
    locale: "en",
    key: "AddItem.occupantAppearedNotice",
    value:
      "Another user added a song at this position. Same song will merge; different song will show as a conflict.",
    reason: VERB_SHOW,
  },
  { locale: "en", key: "Impression.showOriginal", value: "Show original", reason: VERB_SHOW },

  // Event series type label: names the "concert_tour" enum value, not the
  // Event entity.
  {
    locale: "en",
    key: "EventSeries.type.concert_tour",
    value: "Concert Tour",
    reason: "label of the concert_tour series type, not the Event entity",
  },

  // Production copy outside this rollback's scope.
  { locale: "en", key: "Event.standaloneTitle", value: "{artist} — Standalone shows", reason: MAIN_OUT_OF_SCOPE },
  {
    locale: "en",
    key: "Event.setlistUpcoming",
    value: "The setlist will fill in live once the show starts on {date} at {time} ({zone}).",
    reason: MAIN_OUT_OF_SCOPE,
  },
  {
    locale: "en",
    key: "Event.setlistNotRecorded",
    value: "This show’s setlist hasn’t been recorded yet.",
    reason: MAIN_OUT_OF_SCOPE,
  },
  { locale: "en", key: "Event.bd.sectionTitle", value: "This concert's BD", reason: MAIN_OUT_OF_SCOPE },
  {
    locale: "en",
    key: "Predict.lockedHint",
    value: "The show has started; predictions are locked",
    reason: MAIN_OUT_OF_SCOPE,
  },
  { locale: "en", key: "Predict.shareDisabled", value: "Available after the show ends", reason: MAIN_OUT_OF_SCOPE },
  { locale: "en", key: "Predict.afterHint", value: "Show ended · Final result", reason: MAIN_OUT_OF_SCOPE },
  { locale: "en", key: "Predict.copyFromPast", value: "📋 From past show", reason: MAIN_OUT_OF_SCOPE },
  { locale: "en", key: "Predict.copy.sheetTitle", value: "Copy from a past show", reason: MAIN_OUT_OF_SCOPE },
  { locale: "en", key: "Predict.copy.loading", value: "Loading past shows...", reason: MAIN_OUT_OF_SCOPE },
  {
    locale: "en",
    key: "Predict.copy.fetchError",
    value: "Failed to load past shows. Please try again.",
    reason: MAIN_OUT_OF_SCOPE,
  },
  {
    locale: "en",
    key: "Predict.copy.emptyHint",
    value: "No past show in the same series has a confirmed setlist yet",
    reason: MAIN_OUT_OF_SCOPE,
  },
  { locale: "en", key: "Predict.copy.selectButton", value: "Copy from this show", reason: MAIN_OUT_OF_SCOPE },
  { locale: "en", key: "Predict.copy.back", value: "← Pick a different show", reason: MAIN_OUT_OF_SCOPE },
  {
    locale: "en",
    key: "AddItem.errorEventNotOngoing",
    value: "Songs can only be added while the show is ongoing",
    reason: MAIN_OUT_OF_SCOPE,
  },
  {
    locale: "en",
    key: "Board.errorLocked",
    value: "The show has started — picks are closed.",
    reason: MAIN_OUT_OF_SCOPE,
  },
  { locale: "en", key: "Wishlist.title", value: "Songs you want to hear at this show", reason: MAIN_OUT_OF_SCOPE },
  {
    locale: "en",
    key: "Wishlist.description",
    value: "Add the songs you want to hear before the show starts. Up to 3 picks.",
    reason: MAIN_OUT_OF_SCOPE,
  },
  {
    locale: "en",
    key: "Meta.songDescription",
    value: "Members who sang “{title}” by {group} and every show it was performed at",
    reason: MAIN_OUT_OF_SCOPE,
  },
  {
    locale: "en",
    key: "Meta.songDescriptionNoGroup",
    value: "Members who sang “{title}” and every show it was performed at",
    reason: MAIN_OUT_OF_SCOPE,
  },
  {
    locale: "en",
    key: "Meta.seriesDescription",
    value: "Setlists and song order for every show of {name}",
    reason: MAIN_OUT_OF_SCOPE,
  },
];

function isAllowed(locale: Locale, key: string, value: string) {
  return ALLOWED.some((a) => a.locale === locale && a.key === key && a.value === value);
}

describe("event terminology — decided values", () => {
  for (const [key, values] of Object.entries(DECIDED)) {
    it(key, () => {
      for (const locale of LOCALES) {
        expect({ locale, value: FLAT[locale][key] }).toEqual({ locale, value: values[locale] });
      }
    });
  }

  it("ja Hero.heading keeps the <line> markup the hero component splits on", () => {
    expect(FLAT.ja["Hero.heading"]).toMatch(/^(<line>[^<]+<\/line>){2}$/);
  });
});

describe("event terminology — forbidden terms", () => {
  it("the scanner catches each forbidden term", () => {
    expect(FORBIDDEN.en.test("Upcoming concerts")).toBe(true);
    expect(FORBIDDEN.en.test("Explore earlier shows.")).toBe(true);
    expect(FORBIDDEN.en.test("Concert info")).toBe(true);
    expect(FORBIDDEN.ja.test("最近のセトリ")).toBe(true);
    expect(FORBIDDEN.ko.test("지난 셋리스트")).toBe(true);
    // No false positives on the decided spellings.
    expect(FORBIDDEN.ja.test("過去のセットリスト")).toBe(false);
    expect(FORBIDDEN.ko.test("지난 세트리스트")).toBe(false);
  });

  it("no catalog value uses a forbidden term outside the allow-list", () => {
    const offenders: string[] = [];
    let allowedHits = 0;
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(FLAT[locale])) {
        if (!FORBIDDEN[locale].test(value)) continue;
        if (isAllowed(locale, key, value)) allowedHits += 1;
        else offenders.push(`${locale} ${key}: ${value}`);
      }
    }
    // Positive control: the walk really reached the allow-listed values. If
    // flattening ever yielded nothing (an import-shape change, say), the
    // empty offender list below would otherwise pass without scanning.
    expect(allowedHits).toBe(ALLOWED.length);
    expect(offenders).toEqual([]);
  });

  it("every allow-list entry still matches its catalog value and a forbidden term", () => {
    // A stale entry (value edited or key removed) would otherwise linger and
    // read as an approval of wording that no longer exists.
    const stale = ALLOWED.filter(
      (a) => FLAT[a.locale][a.key] !== a.value || !FORBIDDEN[a.locale].test(a.value),
    ).map((a) => `${a.locale} ${a.key}`);
    expect(stale).toEqual([]);
  });
});
