import type { LegalContent } from "@/components/legal/types";

const content: LegalContent = {
  intro:
    "OpenSetlist（以下「本サービス」）は、ユーザーの個人情報を重視し、個人情報保護法を遵守します。",
  lastUpdated: "2026年4月22日",
  sections: [
    {
      id: "collection",
      title: "1. 収集する個人情報",
      blocks: [
        {
          kind: "subgroup",
          label: "自動収集情報（第三者処理者による)",
          intro:
            "以下の情報は、ウェブサービスを提供する過程でホスティング・分析・CDN提供者(Vercel、Google Analytics、Cloudflare)によって収集されます。OpenSetlist 自身のデータベースには保存されません。",
          items: [
            "IPアドレス、訪問履歴、Cookie",
            "ブラウザの種類、OS",
            "閲覧ページ、滞在時間",
          ],
        },
        {
          kind: "subgroup",
          label: "ブラウザのローカルストレージ（localStorage)",
          items: [
            "`opensetlist_first_visit`: 初回訪問日時（再訪問案内用)",
            "`opensetlist_anon_id`: 匿名識別子（UUID)。投稿の重複防止および将来の会員登録時に匿名で作成した投稿を会員アカウントに紐付ける目的で使用します。この識別子はサーバーに保存されますが、IPアドレスやその他の個人情報とは関連付けられません。",
            "ブラウザ設定でサイトデータを削除すると識別子はリセットされ、それ以前の匿名投稿との関連付けは解除されます。",
          ],
        },
        {
          kind: "subgroup",
          label: "会員登録時（Phase 2以降)",
          items: ["メールアドレス", "ニックネーム"],
        },
      ],
    },
    {
      id: "purpose",
      title: "2. 個人情報の利用目的",
      blocks: [
        {
          kind: "ul",
          items: [
            "サービスの提供および改善",
            "訪問者統計分析(Google Analytics)",
            "広告配信(Google AdSense、Kakao AdFit)",
          ],
        },
      ],
    },
    {
      id: "cookies",
      title: "3. Cookieの使用",
      blocks: [
        { kind: "p", text: "本サービスは以下の目的でCookieを使用します。" },
        {
          kind: "ul",
          items: [
            "Google Analytics：訪問者統計分析",
            "Google AdSense：パーソナライズド広告の提供",
            "Kakao AdFit：パーソナライズド広告の提供",
          ],
        },
        {
          kind: "note",
          text: "ブラウザの設定でCookieを拒否できますが、一部サービスの利用が制限される場合があります。",
        },
      ],
    },
    {
      id: "thirdparty",
      title: "4. 第三者への提供",
      blocks: [
        {
          kind: "p",
          text: "収集した情報は、以下の処理者および広告パートナー以外の第三者には提供しません。",
        },
        {
          kind: "subgroup",
          label: "ホスティング・分析・CDN処理者",
          items: [
            "Vercel(ホスティング)",
            "Google Analytics(訪問者分析)",
            "Cloudflare(CDN)",
          ],
        },
        {
          kind: "subgroup",
          label: "広告パートナー",
          items: ["Google AdSense", "Kakao AdFit"],
        },
      ],
    },
    {
      id: "retention",
      title: "5. 個人情報の保有期間",
      blocks: [
        {
          kind: "ul",
          items: [
            "サービス利用期間中保有",
            "退会時に即時削除",
            "法令による保存義務がある場合は該当期間保有",
          ],
        },
      ],
    },
    {
      id: "rights",
      title: "6. ユーザーの権利",
      blocks: [
        {
          kind: "p",
          text: "ユーザーはいつでも以下の権利を行使できます。",
        },
        {
          kind: "ul",
          items: [
            "個人情報の閲覧請求",
            "個人情報の修正請求",
            "個人情報の削除請求",
            "個人情報の処理停止請求",
          ],
        },
      ],
    },
    {
      id: "contact",
      title: "7. お問い合わせ",
      blocks: [
        {
          kind: "p",
          text: "個人情報に関するお問い合わせは以下のメールアドレスまでご連絡ください。",
        },
        { kind: "contact", email: "help@opensetlist.com" },
      ],
    },
  ],
};

export default content;
