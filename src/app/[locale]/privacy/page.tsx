import { getLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";

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
      <p className="mb-8 text-sm text-zinc-400">최종 수정일: 2026년 5월 2일</p>

      <Section title="1. 수집하는 개인정보">
        <p className="mb-2 font-medium">자동 수집 정보</p>
        <ul className="mb-4 list-inside list-disc space-y-1 text-zinc-600">
          <li>방문 기록, IP 주소, 쿠키</li>
          <li>브라우저 종류, 운영체제</li>
          <li>방문 페이지, 체류 시간</li>
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
          수집한 개인정보는 원칙적으로 제3자에게 제공하지 않습니다. 단, 아래의
          경우는 예외입니다:
        </p>
        <ul className="list-inside list-disc space-y-1 text-zinc-600">
          <li>Google Analytics (방문자 분석)</li>
          <li>Google AdSense (광고 서비스)</li>
          <li>Kakao AdFit (광고 서비스)</li>
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
            href="mailto:hello.opensetlist@gmail.com"
            className="text-blue-600 hover:underline"
          >
            hello.opensetlist@gmail.com
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
      <p className="mb-8 text-sm text-zinc-400">Last updated: May 2, 2026</p>

      <Section title="Information We Collect">
        <p className="mb-2 font-medium">Automatically collected:</p>
        <ul className="mb-4 list-inside list-disc space-y-1 text-zinc-600">
          <li>Visit logs, IP address, cookies</li>
          <li>Browser type, operating system</li>
          <li>Pages visited, time spent</li>
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
        <p className="mb-2 text-zinc-600">We share data with:</p>
        <ul className="list-inside list-disc space-y-1 text-zinc-600">
          <li>Google Analytics</li>
          <li>Google AdSense</li>
          <li>Kakao AdFit</li>
        </ul>
      </Section>

      <Section title="Contact">
        <p className="text-zinc-600">
          <a
            href="mailto:hello.opensetlist@gmail.com"
            className="text-blue-600 hover:underline"
          >
            hello.opensetlist@gmail.com
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
      <p className="mb-8 text-sm text-zinc-400">最終更新日: 2026年5月2日</p>

      <Section title="1. 収集する個人情報">
        <p className="mb-2 font-medium">自動収集情報</p>
        <ul className="mb-4 list-inside list-disc space-y-1 text-zinc-600">
          <li>訪問履歴、IPアドレス、Cookie</li>
          <li>ブラウザの種類、OS</li>
          <li>閲覧ページ、滞在時間</li>
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
          収集した個人情報は原則として第三者に提供しません。ただし、以下の場合は例外です：
        </p>
        <ul className="list-inside list-disc space-y-1 text-zinc-600">
          <li>Google Analytics（訪問者分析）</li>
          <li>Google AdSense（広告サービス）</li>
          <li>Kakao AdFit（広告サービス）</li>
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
            href="mailto:hello.opensetlist@gmail.com"
            className="text-blue-600 hover:underline"
          >
            hello.opensetlist@gmail.com
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
