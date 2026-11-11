"use client";

import { createClient } from "@supabase/supabase-js";
import { useState, type FormEvent } from "react";

function isExpectedCallback(value: string, redirectUri: string) {
  try {
    const url = new URL(value);
    return url.origin + url.pathname === redirectUri;
  } catch {
    return false;
  }
}

export default function ConsentForm({ supabaseUrl, anonKey, clientId, subject, redirectUri, authorizationId }: {
  supabaseUrl: string;
  anonKey: string;
  clientId: string;
  subject: string;
  redirectUri: string;
  authorizationId: string;
}) {
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<"sign-in" | "authorization" | null>(null);

  async function authorize(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const supabase = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    setPending(true);
    setFailure(null);
    let phase: "sign-in" | "authorization" = "sign-in";
    try {
      const signIn = await supabase.auth.signInWithPassword({
        email: String(form.get("email") ?? "").trim(),
        password: String(form.get("password") ?? ""),
      });
      if (signIn.error || signIn.data.user?.id !== subject) throw new Error();
      phase = "authorization";
      const details = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
      if (details.error) throw new Error();
      if ("redirect_url" in details.data) {
        if (!isExpectedCallback(details.data.redirect_url, redirectUri)) throw new Error();
        window.location.replace(details.data.redirect_url);
        return;
      }
      const scopes = new Set(details.data.scope.split(/\s+/));
      scopes.delete("email");
      if (details.data.client.id !== clientId || details.data.redirect_uri !== redirectUri ||
          scopes.size !== 2 || !scopes.has("openid") || !scopes.has("offline_access")) throw new Error();
      const approved = await supabase.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true });
      if (approved.error || !isExpectedCallback(approved.data.redirect_url, redirectUri)) throw new Error();
      window.location.replace(approved.data.redirect_url);
    } catch {
      setFailure(phase);
      setPending(false);
    }
  }

  return (
    <form className="space-y-4" method="post" onSubmit={authorize}>
      <label className="block">
        BD 점검 계정 이메일
        <input className="mt-1 block w-full rounded border p-2" name="email" type="email" autoComplete="email" required />
      </label>
      <label className="block">
        비밀번호
        <input className="mt-1 block w-full rounded border p-2" name="password" type="password" autoComplete="current-password" required />
      </label>
      {failure === "sign-in" && <p role="alert">BD 점검 계정으로 로그인하지 못했습니다. 이메일 주소와 비밀번호를 확인해 주세요.</p>}
      {failure === "authorization" && <p role="alert">로그인은 완료됐지만 OAuth 요청을 승인하지 못했습니다. ChatGPT에서 연결을 다시 시작해 주세요.</p>}
      <button className="rounded border px-3 py-2" type="submit" disabled={pending} aria-busy={pending}>
        {pending ? "승인 처리 중…" : "로그인하고 읽기 권한 승인"}
      </button>
    </form>
  );
}
