import type { LegalContent } from "@/components/legal/types";

const content: LegalContent = {
  intro:
    "OpenSetlist(이하 \"서비스\")는 이용자의 개인정보를 중요시하며, 「개인정보 보호법」을 준수합니다.",
  lastUpdated: "2026년 4월 22일",
  sections: [
    {
      id: "collection",
      title: "1. 수집하는 개인정보",
      blocks: [
        {
          kind: "subgroup",
          label: "자동 수집 정보 (제3자 처리자)",
          intro:
            "아래 정보는 웹 서비스 제공 과정에서 호스팅·분석·CDN 제공자(Vercel, Google Analytics, Cloudflare)에 의해 수집됩니다. OpenSetlist는 이러한 정보를 자체 데이터베이스에 저장하지 않습니다.",
          items: [
            "IP 주소, 방문 기록, 쿠키",
            "브라우저 종류, 운영체제",
            "방문 페이지, 체류 시간",
          ],
        },
        {
          kind: "subgroup",
          label: "브라우저 로컬 저장소 (localStorage)",
          items: [
            "`opensetlist_first_visit`: 첫 방문 시각 (재방문 안내 목적)",
            "`opensetlist_anon_id`: 익명 식별자 (UUID). 게시물 중복 방지 및 향후 회원가입 시 익명으로 작성한 기여 내역을 회원 계정에 연결하는 용도로 사용합니다. 이 식별자는 서버에 저장되지만 IP나 다른 개인정보와 연계되지 않습니다.",
            "브라우저 설정에서 사이트 데이터를 삭제하면 식별자가 초기화되며, 이전에 익명으로 작성한 기여 내역과의 연결이 끊어집니다.",
          ],
        },
        {
          kind: "subgroup",
          label: "회원 가입 시 (Phase 2 이후)",
          items: ["이메일 주소", "닉네임"],
        },
      ],
    },
    {
      id: "purpose",
      title: "2. 개인정보 수집 및 이용 목적",
      blocks: [
        {
          kind: "ul",
          items: [
            "서비스 제공 및 개선",
            "방문자 통계 분석 (Google Analytics)",
            "광고 게재 (Google AdSense, Kakao AdFit)",
          ],
        },
      ],
    },
    {
      id: "cookies",
      title: "3. 쿠키(Cookie) 사용",
      blocks: [
        { kind: "p", text: "서비스는 다음 목적으로 쿠키를 사용합니다." },
        {
          kind: "ul",
          items: [
            "Google Analytics: 방문자 통계 분석",
            "Google AdSense: 맞춤형 광고 제공",
            "Kakao AdFit: 맞춤형 광고 제공",
          ],
        },
        {
          kind: "note",
          text: "브라우저 설정에서 쿠키를 거부할 수 있으나, 일부 서비스 이용이 제한될 수 있습니다.",
        },
      ],
    },
    {
      id: "thirdparty",
      title: "4. 제3자 제공",
      blocks: [
        {
          kind: "p",
          text: "수집한 정보는 아래의 처리자 및 광고 파트너 외에는 제3자에게 제공하지 않습니다.",
        },
        {
          kind: "subgroup",
          label: "호스팅·분석·CDN 처리자",
          items: [
            "Vercel (호스팅)",
            "Google Analytics (방문자 분석)",
            "Cloudflare (CDN)",
          ],
        },
        {
          kind: "subgroup",
          label: "광고 파트너",
          items: ["Google AdSense", "Kakao AdFit"],
        },
      ],
    },
    {
      id: "retention",
      title: "5. 개인정보 보유 기간",
      blocks: [
        {
          kind: "ul",
          items: [
            "서비스 이용 기간 동안 보유",
            "회원 탈퇴 시 즉시 삭제",
            "법령에 의한 보존 의무가 있는 경우 해당 기간 보유",
          ],
        },
      ],
    },
    {
      id: "rights",
      title: "6. 이용자 권리",
      blocks: [
        { kind: "p", text: "이용자는 언제든지 다음 권리를 행사할 수 있습니다." },
        {
          kind: "ul",
          items: [
            "개인정보 열람 요청",
            "개인정보 수정 요청",
            "개인정보 삭제 요청",
            "개인정보 처리 정지 요청",
          ],
        },
      ],
    },
    {
      id: "contact",
      title: "7. 문의",
      blocks: [
        {
          kind: "p",
          text: "개인정보 관련 문의는 아래 이메일로 연락해주세요.",
        },
        { kind: "contact", email: "help@opensetlist.com" },
      ],
    },
  ],
};

export default content;
