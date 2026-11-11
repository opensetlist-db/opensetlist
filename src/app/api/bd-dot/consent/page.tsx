import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { bdDotConfig } from "@/lib/bdDotOAuth";
import ConsentForm from "./ConsentForm";

export default async function BdDotOAuthConsent({
  searchParams,
}: {
  searchParams: Promise<{ authorization_id?: string | string[] }>;
}) {
  const config = bdDotConfig();
  const { authorization_id: authorizationId } = await searchParams;
  if (!config || (await headers()).get("host") !== new URL(config.origin).host ||
      typeof authorizationId !== "string" || !/^[a-z0-9_-]{1,256}$/i.test(authorizationId)) notFound();
  const environment = config.environment === "production" ? "운영" : "dev";

  return (
    <main className="mx-auto max-w-lg p-8">
      <h1 className="mb-4 text-xl font-semibold">OpenSetlist {environment} BD 점검 연결</h1>
      <p className="mb-4">{environment} 환경의 현재 점검 대상과 확인 필요 항목을 읽을 수 있습니다.</p>
      <p className="mb-4">ChatGPT는 연결 계정을 식별하기 위해 이메일 주소를 받습니다. 이 연결은 백그라운드에서 토큰을 갱신할 수 있습니다.</p>
      <ConsentForm
        supabaseUrl={config.supabaseUrl}
        anonKey={config.anonKey}
        clientId={config.clientId}
        subject={config.subject}
        redirectUri={config.redirectUri}
        authorizationId={authorizationId}
      />
    </main>
  );
}
