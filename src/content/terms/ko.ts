import type { LegalContent } from "@/lib/types/legal";
import { CONTACT_EMAIL } from "@/lib/config";

const content: LegalContent = {
  lastUpdated: "2026-04-17T00:00:00Z",
  sections: [
    {
      id: "intro",
      title: "1. 서비스 소개",
      blocks: [
        {
          kind: "p",
          text: "OpenSetlist는 라이브 공연의 세트리스트 정보를 제공하는 커뮤니티 데이터베이스입니다.",
        },
      ],
    },
    {
      id: "conditions",
      title: "2. 이용 조건",
      blocks: [
        {
          kind: "ul",
          items: [
            "서비스는 무료로 제공됩니다",
            "상업적 목적의 데이터 수집/재배포를 금지합니다",
            "허위 정보 입력을 금지합니다",
          ],
        },
      ],
    },
    {
      id: "copyright",
      title: "3. 저작권",
      blocks: [
        {
          kind: "ul",
          items: [
            "서비스의 UI/디자인 저작권은 OpenSetlist에 있습니다",
            "공연 정보/셋리스트는 팬 커뮤니티가 수집한 정보입니다",
            "음악 저작권은 각 권리자에게 있습니다",
          ],
        },
      ],
    },
    {
      id: "disclaimer",
      title: "4. 면책 조항",
      blocks: [
        {
          kind: "ul",
          items: [
            "세트리스트 정보의 정확성을 보장하지 않습니다",
            "서비스 중단으로 인한 손해에 책임지지 않습니다",
          ],
        },
      ],
    },
    {
      id: "contact",
      title: "5. 문의",
      blocks: [{ kind: "contact", email: CONTACT_EMAIL }],
    },
  ],
};

export default content;
