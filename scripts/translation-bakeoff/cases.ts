// Hand-picked hard cases for the translation bake-off
// (scripts/translation-bakeoff/run.ts). These are written for the test,
// not taken from users, so they are safe to commit — unlike the run
// output, which also contains real impressions pulled from the dev DB.
//
// Each case targets one failure mode the providers have shown, or could
// plausibly show, on fan impressions. `why` is printed in the report so a
// reviewer knows what to look for in that row.

export type BakeoffCase = {
  id: string;
  sourceLocale: "ko" | "ja" | "en";
  // Which system prompt to send: a registered IP slug or "generic".
  ipKey: string;
  text: string;
  why: string;
};

export const HARD_CASES: BakeoffCase[] = [
  {
    id: "f13-no-glossary",
    sourceLocale: "ko",
    ipKey: "hasunosora",
    text: "시작한다",
    why: "F13: glossary-free short input once came back as [] (extraction misread)",
  },
  {
    id: "unit-nicknames",
    sourceLocale: "ko",
    ipKey: "hasunosora",
    text: "스리부 무대 미쳤다 ㅠㅠㅠ 카호 고음 진짜 소름",
    why: "unit nickname (스리부) + character short name + Korean net slang",
  },
  {
    id: "latin-title-only",
    sourceLocale: "ko",
    ipKey: "hasunosora",
    text: "Dream Believers",
    why: "Latin-script title only: source row must stay verbatim, no locale drift",
  },
  {
    id: "va-nicknames",
    sourceLocale: "ko",
    ipKey: "hasunosora",
    text: "츄케랑 우이사마 MC 너무 웃겼음 ㅋㅋㅋ 낫스는 또 울고",
    why: "VA nicknames (츄케/우이사마/낫스) must map to ちゅけ/ういさま/なっす",
  },
  {
    id: "ja-setlist-term",
    sourceLocale: "ja",
    ipKey: "hasunosora",
    text: "蓮ノ空6th Day2のセトリ神すぎた…吟子ちゃんのソロで泣いた",
    why: "セトリ → Korean must be 세트리스트 (never 셋리스트); 吟子 → 긴코",
  },
  {
    id: "emoji-newline",
    sourceLocale: "ko",
    ipKey: "hasunosora",
    text: "앵콜 마지막 곡 🥹\n코즈에 선배 졸업 인사에서 다들 울었어",
    why: "emoji + newline preserved; 선배 honorific rendered naturally (先輩)",
  },
  {
    id: "en-source",
    sourceLocale: "en",
    ipKey: "hasunosora",
    text: "Hasu's encore was insane. Ginko's solo hit different tonight",
    why: "English source with slang ('hit different'); Hasu → 하스 / 蓮ノ空",
  },
  {
    id: "mixed-script",
    sourceLocale: "ko",
    ipKey: "hasunosora",
    text: "카호짱 かわいい 진짜 오늘 텐션 최고",
    why: "mixed ko/ja in one line; 카호짱 should not be split oddly",
  },
  {
    id: "niji-units",
    sourceLocale: "ko",
    ipKey: "nijigasaki",
    text: "콰츠 무대에서 카나타 자장가 파트 나올 때 다들 숨죽였어",
    why: "Nijigasaki unit (콰츠 → QU4RTZ) + character name via the niji prompt",
  },
  {
    id: "niji-va-change",
    sourceLocale: "ja",
    ipKey: "nijigasaki",
    text: "せつ菜のソロ、こここちゃんの声がもう完全にせつ菜だった",
    why: "VA nickname (こここ = 林鼓子) not in glossary; should not be mistranslated",
  },
  {
    id: "generic-fallback",
    sourceLocale: "ko",
    ipKey: "generic",
    text: "음향이 좀 아쉬웠지만 떼창 구간은 역대급이었다",
    why: "generic prompt; 떼창 (crowd singalong) is a hard Korean concert term",
  },
];
