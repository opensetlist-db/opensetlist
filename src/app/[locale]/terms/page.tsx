import { getLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";

const CONTACT_EMAIL = "help@opensetlist.com";

export async function generateMetadata() {
  const locale = await getLocale();
  const titles: Record<string, string> = {
    ko: "이용약관 — OpenSetlist",
    ja: "利用規約 — OpenSetlist",
    en: "Terms of Service — OpenSetlist",
  };
  return { title: titles[locale] ?? titles.en };
}

function KoContent() {
  return (
    <>
      <h1 className="mb-8 text-2xl font-bold">이용약관</h1>
      <p className="mb-8 text-sm text-zinc-400">최종 수정일: 2026년 4월 17일</p>

      <Section title="1. 서비스 소개">
        <p className="text-zinc-600">
          OpenSetlist는 라이브 공연의 셋리스트 정보를 제공하는 커뮤니티
          데이터베이스입니다.
        </p>
      </Section>

      <Section title="2. 이용 조건">
        <ul className="list-inside list-disc space-y-1 text-zinc-600">
          <li>서비스는 무료로 제공됩니다</li>
          <li>상업적 목적의 데이터 수집/재배포를 금지합니다</li>
          <li>허위 정보 입력을 금지합니다</li>
        </ul>
      </Section>

      <Section title="3. 저작권">
        <ul className="list-inside list-disc space-y-1 text-zinc-600">
          <li>서비스의 UI/디자인 저작권은 OpenSetlist에 있습니다</li>
          <li>공연 정보/셋리스트는 팬 커뮤니티가 수집한 정보입니다</li>
          <li>음악 저작권은 각 권리자에게 있습니다</li>
        </ul>
      </Section>

      <Section title="4. 면책 조항">
        <ul className="list-inside list-disc space-y-1 text-zinc-600">
          <li>셋리스트 정보의 정확성을 보장하지 않습니다</li>
          <li>서비스 중단으로 인한 손해에 책임지지 않습니다</li>
        </ul>
      </Section>

      <Section title="5. 문의">
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

function EnContent() {
  return (
    <>
      <h1 className="mb-8 text-2xl font-bold">Terms of Service</h1>
      <p className="mb-8 text-sm text-zinc-400">Last updated: April 17, 2026</p>

      <Section title="1. About the Service">
        <p className="text-zinc-600">
          OpenSetlist is a community database providing setlist information for
          live events.
        </p>
      </Section>

      <Section title="2. Terms of Use">
        <ul className="list-inside list-disc space-y-1 text-zinc-600">
          <li>The service is provided free of charge</li>
          <li>
            Commercial data scraping or redistribution is prohibited
          </li>
          <li>Submitting false information is prohibited</li>
        </ul>
      </Section>

      <Section title="3. Copyright">
        <ul className="list-inside list-disc space-y-1 text-zinc-600">
          <li>UI/design copyright belongs to OpenSetlist</li>
          <li>
            Performance info and setlists are community-contributed data
          </li>
          <li>Music copyrights belong to their respective owners</li>
        </ul>
      </Section>

      <Section title="4. Disclaimer">
        <ul className="list-inside list-disc space-y-1 text-zinc-600">
          <li>We do not guarantee the accuracy of setlist information</li>
          <li>
            We are not liable for damages caused by service interruptions
          </li>
        </ul>
      </Section>

      <Section title="5. Contact">
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
      <h1 className="mb-8 text-2xl font-bold">利用規約</h1>
      <p className="mb-8 text-sm text-zinc-400">最終更新日: 2026年4月17日</p>

      <Section title="1. サービス紹介">
        <p className="text-zinc-600">
          OpenSetlistは、ライブ公演のセットリスト情報を提供するコミュニティ
          データベースです。
        </p>
      </Section>

      <Section title="2. 利用条件">
        <ul className="list-inside list-disc space-y-1 text-zinc-600">
          <li>サービスは無料で提供されます</li>
          <li>商業目的でのデータ収集・再配布を禁止します</li>
          <li>虚偽の情報入力を禁止します</li>
        </ul>
      </Section>

      <Section title="3. 著作権">
        <ul className="list-inside list-disc space-y-1 text-zinc-600">
          <li>サービスのUI/デザインの著作権はOpenSetlistに帰属します</li>
          <li>公演情報/セットリストはファンコミュニティが収集した情報です</li>
          <li>音楽の著作権は各権利者に帰属します</li>
        </ul>
      </Section>

      <Section title="4. 免責事項">
        <ul className="list-inside list-disc space-y-1 text-zinc-600">
          <li>セットリスト情報の正確性を保証しません</li>
          <li>サービス中断による損害について責任を負いません</li>
        </ul>
      </Section>

      <Section title="5. お問い合わせ">
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

export default async function TermsPage() {
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
