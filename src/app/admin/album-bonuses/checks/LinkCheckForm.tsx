"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { resolveStoreKey } from "@/lib/storeKeys";

const endpoint = "/api/admin/album-bonuses/link-checks";
const inputClass = "mt-1 block w-full rounded border border-zinc-300 bg-white px-3 py-2";
const buttonClass = "rounded border border-zinc-300 bg-white px-3 py-2 disabled:opacity-50";
const labels = { initial: "최초 시도 기록", retry: "재시도 결과 기록", resolve: "확인한 상품 주소 기록" };

type Pending = {
  albumId: string;
  storeKey: string;
  operationId: string;
  body: string;
};

export default function LinkCheckForm({ albumId, storeKey, storeName, revision, phase }: {
  albumId: string;
  storeKey?: string;
  storeName?: string;
  revision: number;
  phase: keyof typeof labels;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [message, setMessage] = useState("");
  const [formVersion, setFormVersion] = useState(0);

  async function read(operation: Pending) {
    const { albumId, storeKey, operationId } = operation;
    const query = new URLSearchParams({ albumId, storeKey, operationId });
    const response = await fetch(`${endpoint}?${query}`, { cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error("반영 여부를 조회하지 못했습니다.");
    return response.json();
  }

  function saved() {
    setPending(null);
    setMessage("저장한 기록을 확인했습니다.");
    setFormVersion((version) => version + 1);
    router.refresh();
  }

  async function send(operation: Pending, recheck: boolean) {
    setBusy(true);
    setPending(operation);
    setMessage("");
    try {
      if (recheck && (await read(operation)).operation) {
        saved();
        return;
      }
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: operation.body,
        signal: AbortSignal.timeout(20000),
      });
      if (response.status === 401) {
        setMessage("관리자 로그인이 만료되었습니다. 로그인 후 반영 여부를 확인하세요.");
        return;
      }
      if (response.status >= 500) throw new Error("서버 응답 오류");
      if (!response.ok) {
        const reply = await response.json();
        setPending(null);
        setMessage(reply.error ?? "입력을 확인해 주세요.");
        if (response.status === 409) router.refresh();
        return;
      }
      if ((await read(operation)).operation) saved();
      else setMessage("응답을 받았지만 저장 기록을 조회하지 못했습니다.");
    } catch {
      try {
        if ((await read(operation)).operation) {
          saved();
          return;
        }
      } catch {
        // Preserve the exact request for a read-before-retry after connectivity returns.
      }
      setMessage("저장 여부를 확인하지 못했습니다. 먼저 기록을 다시 조회하세요.");
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || pending) return;
    const values = new FormData(event.currentTarget);
    const value = (name: string) => String(values.get(name) ?? "").trim();
    const name = storeName ?? value("storeName");
    const known = resolveStoreKey(name);
    const key = storeKey ?? (known === "other" ? value("storeKey") : known);
    if (!key) {
      setMessage("판매점 식별자를 입력하세요.");
      return;
    }
    const operationId = crypto.randomUUID();
    const body = JSON.stringify({
      albumId, storeKey: key, storeName: name, operationId, phase, expectedRevision: revision,
      observedAt: new Date().toISOString(),
      evidenceUrl: value("evidenceUrl"), summary: value("summary"), productUrl: value("productUrl") || null,
    });
    void send({ albumId, storeKey: key, operationId, body }, false);
  }

  return (
    <details className="rounded border border-zinc-200 p-3">
      <summary className="cursor-pointer font-medium">{labels[phase]}</summary>
      <form key={formVersion} onSubmit={submit} className="mt-3">
        <fieldset disabled={busy || pending !== null} className="space-y-2">
          {phase === "initial" && (
            <>
              <label className="block">공식 판매점 이름
                <input name="storeName" required maxLength={128} className={inputClass} />
              </label>
              <label className="block">판매점 식별자 (자동으로 식별되지 않는 판매점)
                <input name="storeKey" maxLength={100} className={inputClass} />
              </label>
            </>
          )}
          <label className="block">확인한 상품 주소 {phase !== "resolve" && "(미확보 시 비워 두세요)"}
            <input name="productUrl" type="url" required={phase === "resolve"} maxLength={2048} className={inputClass} />
          </label>
          <label className="block">공식 안내 또는 관찰 근거 URL
            <input name="evidenceUrl" type="url" required maxLength={2048} className={inputClass} />
          </label>
          <label className="block">관찰 요약
            <textarea name="summary" required maxLength={2048} className={inputClass} />
          </label>
          <button type="submit" className={buttonClass}>시도 결과 저장</button>
        </fieldset>
      </form>
      <p role="status">{message || (busy ? "확인 중…" : "")}</p>
      {pending && <button type="button" disabled={busy} className={buttonClass} onClick={() => void send(pending, true)}>
        반영 여부 조회 후 미반영 시 같은 요청 보내기
      </button>}
    </details>
  );
}
