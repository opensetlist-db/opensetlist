"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { getBonusLifecycle } from "@/lib/bonusLifecycle";
import { isSafeExternalUrl } from "@/lib/utils";

type Lifecycle = Awaited<ReturnType<typeof getBonusLifecycle>>;

function period(start: string | null, end: string | null) {
  return `${start ?? "시작 미정"} ~ ${end ?? "종료 미정"}`;
}

function historyState(value: Lifecycle["history"][number]["before"]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "—";
  return `${value.endedAt ? "종료" : "수동 종료 없음"} · ${period(
    typeof value.startsAt === "string" ? value.startsAt : null,
    typeof value.endsAt === "string" ? value.endsAt : null,
  )}`;
}

async function readLifecycle(url: string, listingId: string, operationId: string | null): Promise<Lifecycle> {
  const query = new URLSearchParams({ listingId });
  if (operationId) query.set("operationId", operationId);
  const response = await fetch(`${url}?${query}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 401) throw new Error("관리자 로그인이 만료되었습니다. 로그인 후 반영 여부를 확인해 주세요.");
  if (!response.ok) throw new Error("특전의 저장 상태를 조회하지 못했습니다.");
  return response.json();
}

export default function BonusLifecyclePanel({ id, listingId, purchaseHref }: {
  id: string;
  listingId: string;
  purchaseHref: string;
}) {
  const router = useRouter();
  const url = `/api/admin/album-bonuses/${encodeURIComponent(id)}/lifecycle`;
  const storageKey = `bonus-lifecycle:${listingId}:${id}`;
  const [result, setResult] = useState<Lifecycle | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(true);
  const [formVersion, setFormVersion] = useState(0);

  useEffect(() => {
    let current = true;
    async function load() {
      try {
        const operationId = sessionStorage.getItem(storageKey);
        const data = await readLifecycle(url, listingId, operationId);
        if (!current) return;
        setResult(data);
        if (operationId) {
          sessionStorage.removeItem(storageKey);
          setMessage(data.operation
            ? "이미 반영된 요청입니다. 새 구매 탭에서 확인해 주세요."
            : "이 작업의 저장 이력이 없습니다. 최신 상태를 확인한 뒤 다시 제출할 수 있습니다.");
        }
      } catch (error) {
        if (current) setMessage(error instanceof Error ? error.message : "특전 상태를 조회하지 못했습니다.");
      } finally {
        if (current) setBusy(false);
      }
    }
    void load();
    return () => { current = false; };
  }, [listingId, storageKey, url]);

  function clearPending() {
    sessionStorage.removeItem(storageKey);
    setPending(null);
  }

  async function reconcile(operationId: string | null, appliedMessage: string, missingMessage: string, saved = false) {
    try {
      const data = await readLifecycle(url, listingId, operationId);
      setResult(data);
      clearPending();
      setMessage(operationId ? (data.operation ? appliedMessage : missingMessage) : missingMessage);
      if (data.operation) {
        setFormVersion((version) => version + 1);
        router.refresh();
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "잠시 후 다시 확인해 주세요.";
      setMessage(saved ? `${appliedMessage} 이력 조회를 다시 시도해 주세요. ${detail}` : `반영 여부를 다시 조회해 주세요. ${detail}`);
    }
  }

  const state = result?.state;
  const restoring = Boolean(state && (state.endedAt || (state.endsAt && new Date(state.endsAt) <= new Date())));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!state || pending || busy) return;
    const values = new FormData(event.currentTarget);
    const value = (name: string) => String(values.get(name) ?? "").trim();
    const operationId = crypto.randomUUID();
    setBusy(true);
    setMessage("");
    try {
      sessionStorage.setItem(storageKey, operationId);
      setPending(operationId);
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(20000),
        body: JSON.stringify({
          listingId, operationId, expectedRevision: state.revision, expectedListingRevision: state.listingRevision,
          action: restoring ? "restore" : "end",
          evidenceUrl: value("evidenceUrl"), summary: value("summary"), observedAt: value("observedAt"),
          ...(restoring && { startsAt: value("startsAt") || null, endsAt: value("endsAt") || null }),
        }),
      });
      if (response.status === 401) {
        clearPending();
        setMessage("관리자 로그인이 만료되었습니다. 로그인 후 다시 열어 주세요.");
        return;
      }
      const body = await response.json();
      if (response.ok) {
        const saved = body.status === "already_applied" ? "이미 반영된 요청입니다." : "저장했습니다.";
        const cache = body.cache === "warning" ? " 공개 캐시 갱신에 실패했습니다." : "";
        await reconcile(operationId, `${saved}${cache} 새 구매 탭에서 확인해 주세요.`, `${saved}${cache}`, true);
      } else if (response.status >= 500) {
        await reconcile(operationId, "이미 반영된 요청입니다. 새 구매 탭에서 확인해 주세요.", body.error ?? "저장에 실패했습니다.");
      } else {
        clearPending();
        setMessage(body.error ?? "입력을 확인해 주세요.");
        if (response.status === 409) setResult(null);
      }
    } catch {
      await reconcile(operationId, "응답이 유실되었지만 요청은 반영되었습니다. 새 구매 탭에서 확인해 주세요.",
        "이 작업의 저장 이력이 없습니다. 최신 상태를 확인한 뒤 다시 제출할 수 있습니다.");
    } finally {
      setBusy(false);
    }
  }

  const inputClass = "mt-1 w-full rounded border border-zinc-300 bg-white px-3 py-2";
  return (
    <div className="space-y-3 rounded border border-zinc-200 bg-zinc-50 p-4">
      <a href={purchaseHref} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
        공개 구매 탭 새로 열기
      </a>
      <p role="status">{message || (busy ? "확인 중…" : "")}</p>
      {(!state || pending) && !busy && (
        <button type="button" className="rounded border px-3 py-2" onClick={async () => {
          setBusy(true);
          try {
            await reconcile(pending ?? sessionStorage.getItem(storageKey),
              "이미 반영된 요청입니다. 새 구매 탭에서 확인해 주세요.", "최신 상태를 확인했습니다.");
          } finally {
            setBusy(false);
          }
        }}>
          반영 여부 다시 조회
        </button>
      )}
      {state && (
        <>
          <p>{restoring ? "종료" : "수동 종료 없음"} · <span className="break-all">{period(state.startsAt, state.endsAt)}</span></p>
          <form key={formVersion} onSubmit={submit} className="space-y-2">
            <fieldset disabled={busy || pending !== null} className="space-y-2">
              <legend className="font-medium">특전 {restoring ? "복구" : "종료"}</legend>
              <label className="block">근거 URL
                <input name="evidenceUrl" type="url" required maxLength={2048} className={inputClass} />
              </label>
              <label className="block">관찰 요약
                <textarea name="summary" required maxLength={2048} className={inputClass} />
              </label>
              <label className="block">관찰 시각 (ISO 8601)
                <input name="observedAt" required defaultValue={new Date().toISOString()} className={inputClass} />
              </label>
              {restoring && (
                <>
                  <label className="block">시작 시각 (ISO 8601)
                    <input name="startsAt" defaultValue={state.startsAt ?? ""} className={inputClass} />
                  </label>
                  <label className="block">종료 시각 (ISO 8601)
                    <input name="endsAt" defaultValue={state.endsAt ?? ""} className={inputClass} />
                  </label>
                </>
              )}
              <button type="submit" data-testid="bonus-lifecycle-submit"
                className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50">
                {restoring ? "특전 복구" : "특전 종료"}
              </button>
            </fieldset>
          </form>
        </>
      )}
      <section data-testid="bonus-lifecycle-history" aria-label="종료·복구 이력">
        <h3 className="font-medium">종료·복구 이력</h3>
        {result && (result.history.length ? (
          <ol className="divide-y divide-zinc-200">
            {result.history.map((entry) => (
              <li key={entry.operationId} className="space-y-1 break-words py-2">
                <p>{entry.action === "end" ? "종료" : "복구"} · 관찰 <time dateTime={entry.observedAt}>{entry.observedAt}</time></p>
                <p>{entry.summary}</p>
                {isSafeExternalUrl(entry.evidenceUrl) && (
                  <a href={entry.evidenceUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
                    관찰 근거 열기
                  </a>
                )}
                <p>변경 전 · {historyState(entry.before)}</p>
                <p>변경 후 · {historyState(entry.after)}</p>
              </li>
            ))}
          </ol>
        ) : <p>기록된 이력이 없습니다.</p>)}
      </section>
    </div>
  );
}
