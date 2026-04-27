import type { LegalContent } from "@/lib/types/legal";
import { CONTACT_EMAIL } from "@/lib/config";

const content: LegalContent = {
  lastUpdated: "2026年4月17日",
  sections: [
    {
      id: "intro",
      title: "1. サービス紹介",
      blocks: [
        {
          kind: "p",
          text: "OpenSetlistは、ライブ公演のセットリスト情報を提供するコミュニティデータベースです。",
        },
      ],
    },
    {
      id: "conditions",
      title: "2. 利用条件",
      blocks: [
        {
          kind: "ul",
          items: [
            "サービスは無料で提供されます",
            "商業目的でのデータ収集・再配布を禁止します",
            "虚偽の情報入力を禁止します",
          ],
        },
      ],
    },
    {
      id: "copyright",
      title: "3. 著作権",
      blocks: [
        {
          kind: "ul",
          items: [
            "サービスのUI/デザインの著作権はOpenSetlistに帰属します",
            "公演情報/セットリストはファンコミュニティが収集した情報です",
            "音楽の著作権は各権利者に帰属します",
          ],
        },
      ],
    },
    {
      id: "disclaimer",
      title: "4. 免責事項",
      blocks: [
        {
          kind: "ul",
          items: [
            "セットリスト情報の正確性を保証しません",
            "サービス中断による損害について責任を負いません",
          ],
        },
      ],
    },
    {
      id: "contact",
      title: "5. お問い合わせ",
      blocks: [{ kind: "contact", email: CONTACT_EMAIL }],
    },
  ],
};

export default content;
