import { getLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { CONTACT_EMAIL } from "@/lib/config";

export async function generateMetadata() {
  const locale = await getLocale();
  const titles: Record<string, string> = {
    ko: "개인정보처리방침 — OpenSetlist",
    ja: "プライバシーポリシー — OpenSetlist",
    en: "Privacy Policy — OpenSetlist",
  };
  return { title: titles[locale] ?? titles.en };
}

function KoContent() {
  return (
    <>
      <h1 className="mb-8 text-2xl font-bold">개인정보처리방침</h1>

      <p className="mb-6 text-zinc-600">
        OpenSetlist(이하 &quot;서비스&quot;)는 이용자의 개인정보를 중요시하며,
        「개인정보 보호법」을 준수합니다.
      </p>
      <p className="mb-8 text-sm text-zinc-400">최종 수정일: 2026년 4월 22일</p>

      <Section title="1. 수집하는 개인정보">
        <p className="mb-2 font-medium">자동 수집 정보 (제3자 처리자)</p>
        <p className="mb-2 text-zinc-600">
          아래 정보는 웹 서비스 제공 과정에서 호스팅·분석·CDN 제공자(Vercel,
          Google Analytics, Cloudflare)에 의해 수집됩니다. OpenSetlist는 이러한
          정보를 자체 데이터베이스에 저장하지 않습니다:
        </p>
        <ul className="mb-4 list-inside list-disc space-y-1 text-zinc-600">
          <li>IP 주소, 방문 기록, 쿠키</li>
          <li>브라우저 종류, 운영체제</li>
          <li>방문 페이지, 체류 시간</li>
        </ul>
        <p className="mb-2 font-medium">브라우저 로컬 저장소 (localStorage)</p>
        <ul className="mb-4 list-inside list-disc space-y-1 text-zinc-600">
          <li>
            <code>opensetlist_first_visit</code>: 첫 방문 시각 (재방문 안내 목적)
          </li>
          <li>
            <code>opensetlist_anon_id</code>: 익명 식별자 (UUID). 게시물 중복
            방지 및 향후 회원가입 시 익명으로 작성한 기여 내역을 회원 계정에
            연결하는 용도로 사용합니다. 이 식별자는 서버에 저장되지만 IP나 다른
            개인정보와 연계되지 않습니다.
          </li>
          <li>
            브라우저 설정에서 사이트 데이터를 삭제하면 식별자가 초기화되며,
            이전에 익명으로 작성한 기여 내역과의 연결이 끊어집니다.
          </li>
        </ul>
        <p className="mb-2 font-medium">회원 가입 시 (Phase 2 이후)</p>
        <ul className="list-inside list-disc space-y-1 text-zinc-600">
          <li>이메일 주소</li>
          <li>닉네임</li>
        </ul>
      </Section>

      <Section title="2. 개인정보 수집 및 이용 목적">
        <ul className="list-inside list-disc space-y-1 text-zinc-600">
          <li>서비스 제공 및 개선</li>
          <li>방문자 통계 분석 (Google Analytics)</li>
          <li>광고 게재 (Google AdSense, Kakao AdFit)</li>
        </ul>
      </Section>

      <Section title="3. 쿠키(Cookie) 사용">
        <p className="mb-2 text-zinc-600">
          서비스는 다음 목적으로 쿠키를 사용합니다:
        </p>
        <ul className="mb-4 list-inside list-disc space-y-1 text-zinc-600">
          <li>Google Analytics: 방문자 통계 분석</li>
          <li>Google AdSense: 맞춤형 광고 제공</li>
          <li>Kakao AdFit: 맞춤형 광고 제공</li>
        </ul>
        <p className="text-zinc-600">
          브라우저 설정에서 쿠키를 거부할 수 있으나, 일부 서비스 이용이 제한될 수
          있습니다.
        </p>
      </Section>

      <Section title="4. 제3자 제공">
        <p className="mb-2 text-zinc-600">
          수집한 정보는 아래의 처리자 및 광고 파트너 외에는 제3자에게 제공하지
          않습니다:
        </p>
        <p className="mb-1 mt-2 font-medium">호스팅·분석·CDN 처리자</p>
        <ul className="mb-3 list-inside list-disc space-y-1 text-zinc-600">
          <li>Vercel (호스팅)</li>
          <li>Google Analytics (방문자 분석)</li>
          <li>Cloudflare (CDN)</li>
        </ul>
        <p className="mb-1 mt-2 font-medium">광고 파트너</p>
        <ul className="list-inside list-disc space-y-1 text-zinc-600">
          <li>Google AdSense</li>
          <li>Kakao AdFit</li>
        </ul>
      </Section>

      <Section title="5. 개인정보 보유 기간">
        <ul className="list-inside list-disc space-y-1 text-zinc-600">
          <li>서비스 이용 기간 동안 보유</li>
          <li>회원 탈퇴 시 즉시 삭제</li>
          <li>법령에 의한 보존 의무가 있는 경우 해당 기간 보유</li>
        </ul>
      </Section>

      <Section title="6. 이용자 권리">
        <p className="mb-2 text-zinc-600">
          이용자는 언제든지 다음 권리를 행사할 수 있습니다:
        </p>
        <ul className="list-inside list-disc space-y-1 text-zinc-600">
          <li>개인정보 열람 요청</li>
          <li>개인정보 수정 요청</li>
          <li>개인정보 삭제 요청</li>
          <li>개인정보 처리 정지 요청</li>
        </ul>
      </Section>

      <Section title="7. 문의">
        <p className="text-zinc-600">
          개인정보 관련 문의:{" "}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="text-blue-600 hover:underline"
          >
            {CONTACT_EMAIL}
          </a>
        </p>
      </Section>
    </>
  );
}

function EnContent() {
  return (
    <>
      <h1 className="mb-8 text-2xl font-bold">Privacy Policy</h1>
      <p className="mb-8 text-sm text-zinc-400">Last updated: April 22, 2026</p>

      <Section title="Information We Collect">
        <p className="mb-2 font-medium">
          Automatically collected (by third-party processors):
        </p>
        <p className="mb-2 text-zinc-600">
          The following is collected by our hosting, analytics, and CDN
          providers (Vercel, Google Analytics, Cloudflare) as a necessary
          part of serving the website. OpenSetlist does not store this data
          in its own database:
        </p>
        <ul className="mb-4 list-inside list-disc space-y-1 text-zinc-600">
          <li>IP address, visit logs, cookies</li>
          <li>Browser type, operating system</li>
          <li>Pages visited, time spent</li>
        </ul>
        <p className="mb-2 font-medium">Browser Local Storage (localStorage):</p>
        <ul className="mb-4 list-inside list-disc space-y-1 text-zinc-600">
          <li>
            <code>opensetlist_first_visit</code>: timestamp of first visit
            (used for return-visitor UI).
          </li>
          <li>
            <code>opensetlist_anon_id</code>: anonymous identifier (UUID).
            Used to prevent duplicate submissions and, when you create an
            account in the future, to link contributions you made anonymously
            to that account. This identifier is stored on our servers but is
            not linked to your IP address or any other personal information.
          </li>
          <li>
            Clearing your browser site data resets this identifier and severs
            the link to any prior anonymous contributions.
          </li>
        </ul>
        <p className="mb-2 font-medium">On registration (Phase 2):</p>
        <ul className="list-inside list-disc space-y-1 text-zinc-600">
          <li>Email address</li>
          <li>Username</li>
        </ul>
      </Section>

      <Section title="How We Use Information">
        <ul className="list-inside list-disc space-y-1 text-zinc-600">
          <li>Provide and improve the service</li>
          <li>Visitor analytics (Google Analytics)</li>
          <li>Advertising (Google AdSense, Kakao AdFit)</li>
        </ul>
      </Section>

      <Section title="Cookies">
        <p className="mb-2 text-zinc-600">We use cookies for:</p>
        <ul className="mb-4 list-inside list-disc space-y-1 text-zinc-600">
          <li>Google Analytics: visitor statistics</li>
          <li>Google AdSense: personalized ads</li>
          <li>Kakao AdFit: personalized ads</li>
        </ul>
        <p className="text-zinc-600">
          You can disable cookies in your browser settings.
        </p>
      </Section>

      <Section title="Third Parties">
        <p className="mb-2 text-zinc-600">
          We share data only with the processors and advertising partners
          listed below:
        </p>
        <p className="mb-1 mt-2 font-medium">
          Hosting / Analytics / CDN processors
        </p>
        <ul className="mb-3 list-inside list-disc space-y-1 text-zinc-600">
          <li>Vercel (hosting)</li>
          <li>Google Analytics (visitor analytics)</li>
          <li>Cloudflare (CDN)</li>
        </ul>
        <p className="mb-1 mt-2 font-medium">Advertising partners</p>
        <ul className="list-inside list-disc space-y-1 text-zinc-600">
          <li>Google AdSense</li>
          <li>Kakao AdFit</li>
        </ul>
      </Section>

      <Section title="Data Retention">
        <ul className="list-inside list-disc space-y-1 text-zinc-600">
          <li>Retained during service usage</li>
          <li>Deleted immediately upon account deletion</li>
          <li>Retained as required by law</li>
        </ul>
      </Section>

      <Section title="Your Rights">
        <p className="mb-2 text-zinc-600">
          You may exercise the following rights at any time:
        </p>
        <ul className="list-inside list-disc space-y-1 text-zinc-600">
          <li>Request access to your personal data</li>
          <li>Request correction of your personal data</li>
          <li>Request deletion of your personal data</li>
          <li>Request to stop processing your personal data</li>
        </ul>
      </Section>

      <Section title="Contact">
        <p className="text-zinc-600">
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="text-blue-600 hover:underline"
          >
            {CONTACT_EMAIL}
          </a>
        </p>
      </Section>
    </>
  );
}

function JaContent() {
  return (
    <>
      <h1 className="mb-8 text-2xl font-bold">プライバシーポリシー</h1>

      <p className="mb-6 text-zinc-600">
        OpenSetlist（以下「本サービス」）は、ユーザーの個人情報を重視し、
        個人情報保護法を遵守します。
      </p>
      <p className="mb-8 text-sm text-zinc-400">最終更新日: 2026年4月22日</p>

      <Section title="1. 収集する個人情報">
        <p className="mb-2 font-medium">自動収集情報（第三者処理者による）</p>
        <p className="mb-2 text-zinc-600">
          以下の情報は、ウェブサービスを提供する過程でホスティング・分析・CDN提供者（Vercel、Google
          Analytics、Cloudflare）によって収集されます。OpenSetlist
          自身のデータベースには保存されません：
        </p>
        <ul className="mb-4 list-inside list-disc space-y-1 text-zinc-600">
          <li>IPアドレス、訪問履歴、Cookie</li>
          <li>ブラウザの種類、OS</li>
          <li>閲覧ページ、滞在時間</li>
        </ul>
        <p className="mb-2 font-medium">
          ブラウザのローカルストレージ（localStorage）
        </p>
        <ul className="mb-4 list-inside list-disc space-y-1 text-zinc-600">
          <li>
            <code>opensetlist_first_visit</code>: 初回訪問日時（再訪問案内用）
          </li>
          <li>
            <code>opensetlist_anon_id</code>:
            匿名識別子（UUID）。投稿の重複防止および将来の会員登録時に匿名で作成した
            投稿を会員アカウントに紐付ける目的で使用します。この識別子はサーバーに
            保存されますが、IPアドレスやその他の個人情報とは関連付けられません。
          </li>
          <li>
            ブラウザ設定でサイトデータを削除すると識別子はリセットされ、
            それ以前の匿名投稿との関連付けは解除されます。
          </li>
        </ul>
        <p className="mb-2 font-medium">会員登録時（Phase 2以降）</p>
        <ul className="list-inside list-disc space-y-1 text-zinc-600">
          <li>メールアドレス</li>
          <li>ニックネーム</li>
        </ul>
      </Section>

      <Section title="2. 個人情報の利用目的">
        <ul className="list-inside list-disc space-y-1 text-zinc-600">
          <li>サービスの提供および改善</li>
          <li>訪問者統計分析（Google Analytics）</li>
          <li>広告配信（Google AdSense、Kakao AdFit）</li>
        </ul>
      </Section>

      <Section title="3. Cookieの使用">
        <p className="mb-2 text-zinc-600">
          本サービスは以下の目的でCookieを使用します：
        </p>
        <ul className="mb-4 list-inside list-disc space-y-1 text-zinc-600">
          <li>Google Analytics：訪問者統計分析</li>
          <li>Google AdSense：パーソナライズド広告の提供</li>
          <li>Kakao AdFit：パーソナライズド広告の提供</li>
        </ul>
        <p className="text-zinc-600">
          ブラウザの設定でCookieを拒否できますが、一部サービスの利用が制限される場合があります。
        </p>
      </Section>

      <Section title="4. 第三者への提供">
        <p className="mb-2 text-zinc-600">
          収集した情報は、以下の処理者および広告パートナー以外の第三者には提供しません：
        </p>
        <p className="mb-1 mt-2 font-medium">ホスティング・分析・CDN処理者</p>
        <ul className="mb-3 list-inside list-disc space-y-1 text-zinc-600">
          <li>Vercel（ホスティング）</li>
          <li>Google Analytics（訪問者分析）</li>
          <li>Cloudflare（CDN）</li>
        </ul>
        <p className="mb-1 mt-2 font-medium">広告パートナー</p>
        <ul className="list-inside list-disc space-y-1 text-zinc-600">
          <li>Google AdSense</li>
          <li>Kakao AdFit</li>
        </ul>
      </Section>

      <Section title="5. 個人情報の保有期間">
        <ul className="list-inside list-disc space-y-1 text-zinc-600">
          <li>サービス利用期間中保有</li>
          <li>退会時に即時削除</li>
          <li>法令による保存義務がある場合は該当期間保有</li>
        </ul>
      </Section>

      <Section title="6. ユーザーの権利">
        <p className="mb-2 text-zinc-600">
          ユーザーはいつでも以下の権利を行使できます：
        </p>
        <ul className="list-inside list-disc space-y-1 text-zinc-600">
          <li>個人情報の閲覧請求</li>
          <li>個人情報の修正請求</li>
          <li>個人情報の削除請求</li>
          <li>個人情報の処理停止請求</li>
        </ul>
      </Section>

      <Section title="7. お問い合わせ">
        <p className="text-zinc-600">
          個人情報に関するお問い合わせ：{" "}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="text-blue-600 hover:underline"
          >
            {CONTACT_EMAIL}
          </a>
        </p>
      </Section>
    </>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <h2 className="mb-4 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default async function PrivacyPage() {
  const locale = await getLocale();

  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      {locale === "ja" ? (
        <JaContent />
      ) : locale === "en" ? (
        <EnContent />
      ) : (
        <KoContent />
      )}
      <div className="mt-12 border-t pt-6">
        <Link href="/" className="text-sm text-blue-600 hover:underline">
          &larr;{" "}
          {locale === "ja"
            ? "ホームに戻る"
            : locale === "en"
              ? "Back to Home"
              : "홈으로 돌아가기"}
        </Link>
      </div>
    </main>
  );
}
