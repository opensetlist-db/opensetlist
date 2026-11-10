"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { officialStoreKey } from "@/lib/storeKeys";
import { forgetOperation, storedOperation, storeOperation, type PendingOperation } from "../pendingOperation";

const endpoint = "/api/admin/album-bonuses/link-checks";
const inputClass = "mt-1 block w-full rounded border border-zinc-300 bg-white px-3 py-2";
const buttonClass = "rounded border border-zinc-300 bg-white px-3 py-2 disabled:opacity-50";
const labels = {
  initial: "최초 시도 기록", retry: "재시도 결과 기록", resolve: "확인한 상품 주소 기록",
  exclude: "점검 제외 기록", reinclude: "점검 재포함 기록",
};

async function read(albumId: string, operation: PendingOperation) {
  const target = JSON.parse(operation.body);
  if (target?.albumId !== albumId || typeof target.storeKey !== "string") throw new Error("구매 옵션이 다릅니다.");
  const query = new URLSearchParams({ albumId, storeKey: target.storeKey, operationId: operation.operationId });
  const response = await fetch(`${endpoint}?${query}`, { cache: "no-store", signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error("반영 여부를 조회하지 못했습니다.");
  return response.json();
}

export default function LinkCheckForm({ albumId, storeKey, storeName, revision, phase }: {
  albumId: string;
  storeKey?: string;
  storeName?: string;
  revision: number;
  phase?: keyof typeof labels;
}) {
  const router = useRouter();
  const storageKey = `bonus-link-check:${JSON.stringify([albumId, storeKey])}`;
  const [busy, setBusy] = useState(true);
  const [pending, setPending] = useState<PendingOperation | null>(null);
  const [message, setMessage] = useState("");
  const [formVersion, setFormVersion] = useState(0);
  const [exclude, setExclude] = useState(false);
  const canExclude = phase === "retry" || phase === "resolve";
  const action = exclude ? "exclude" : phase;
  const isReviewDecision = action === "exclude" || action === "reinclude";

  useEffect(() => {
    let current = true;
    async function recover() {
      const operation = storedOperation(storageKey);
      try {
        if (!operation) return;
        if ((await read(albumId, operation)).operation) {
          forgetOperation(storageKey, operation.operationId);
          if (current) setMessage("이미 반영된 요청입니다.");
          return;
        }
      } catch {
        // Keep the original request until its receipt can be checked.
      } finally {
        if (current) setBusy(false);
      }
      if (current && operation) {
        setPending(operation);
        setMessage("저장 여부를 먼저 다시 조회하세요.");
      }
    }
    void recover();
    return () => { current = false; };
  }, [albumId, storageKey]);

  function saved(operationId: string) {
    forgetOperation(storageKey, operationId);
    setPending(null);
    setExclude(false);
    setMessage("저장한 기록을 확인했습니다.");
    setFormVersion((version) => version + 1);
    router.refresh();
  }

  async function send(operation: PendingOperation, recheck: boolean) {
    setBusy(true);
    setPending(operation);
    setMessage("");
    storeOperation(storageKey, operation);
    try {
      if (recheck && (await read(albumId, operation)).operation) {
        saved(operation.operationId);
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
        forgetOperation(storageKey, operation.operationId);
        setPending(null);
        setMessage(reply.error ?? "입력을 확인해 주세요.");
        if (response.status === 409) router.refresh();
        return;
      }
      if ((await read(albumId, operation)).operation) saved(operation.operationId);
      else setMessage("응답을 받았지만 저장 기록을 조회하지 못했습니다.");
    } catch {
      try {
        if ((await read(albumId, operation)).operation) {
          saved(operation.operationId);
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
    if (busy || pending || !action) return;
    const values = new FormData(event.currentTarget);
    const value = (name: string) => String(values.get(name) ?? "").trim();
    const name = storeName ?? value("storeName");
    const key = storeKey ?? officialStoreKey(name);
    if (!key) {
      setMessage("판매점 식별자를 입력하세요.");
      return;
    }
    const operationId = crypto.randomUUID();
    const body = JSON.stringify({
      albumId, storeKey: key, storeName: name, operationId, phase: action, expectedRevision: revision,
      observedAt: new Date().toISOString(),
      evidenceUrl: value("evidenceUrl"), summary: value("summary"), productUrl: value("productUrl") || null,
      ...(isReviewDecision && { evidenceType: value("evidenceType") }),
    });
    void send({ operationId, body }, false);
  }

  if (!phase && !pending) return message ? <p role="status">{message}</p> : null;

  return (
    <details open={pending || message ? true : undefined} className="rounded border border-zinc-200 p-3">
      <summary className="cursor-pointer font-medium">{phase ? labels[phase] : "저장 기록 확인"}</summary>
      {action && <form key={formVersion} onSubmit={submit} className="mt-3">
        <fieldset disabled={busy || pending !== null} className="space-y-2">
          {canExclude && (
            <label className="block">기록할 작업
              <select value={action} onChange={(event) => {
                setExclude(event.target.value === "exclude");
                setMessage("");
              }} className={inputClass}>
                <option value={phase}>{labels[phase]}</option>
                <option value="exclude">{labels.exclude}</option>
              </select>
            </label>
          )}
          {phase === "initial" && (
            <>
              <label className="block">공식 판매점 이름
                <input name="storeName" required maxLength={100} className={inputClass} />
              </label>
            </>
          )}
          {!isReviewDecision && <label className="block">확인한 상품 주소 {phase !== "resolve" && "(미확보 시 비워 두세요)"}
            <input name="productUrl" type="url" required={phase === "resolve"} maxLength={2048} className={inputClass} />
          </label>}
          {isReviewDecision && <p>{action === "exclude"
            ? "해당 판매점의 조사 대상 특전이 모두 종료·만료됐다는 명확한 근거를 남기세요. 일시품절·접근 실패·정보 누락은 확인 대상으로 남겨 주세요."
            : "다시 점검할 특전이 있다는 근거를 남기세요."}</p>}
          {isReviewDecision && <label className="block">근거 유형
            <select name="evidenceType" defaultValue="" required className={inputClass}>
              <option value="" disabled>선택하세요</option>
              {action === "exclude" ? <>
                <option value="expired">기한 만료</option>
                <option value="ended">종료·소진 확인</option>
              </> : <option value="active">다시 제공 중</option>}
            </select>
          </label>}
          <label className="block">공식 안내 또는 관찰 근거 URL
            <input name="evidenceUrl" type="url" required maxLength={2048} className={inputClass} />
          </label>
          <label className="block">관찰 요약
            <textarea name="summary" required maxLength={2048} className={inputClass} />
          </label>
          <button type="submit" className={buttonClass}>{isReviewDecision ? "점검 결정 저장" : "시도 결과 저장"}</button>
        </fieldset>
      </form>}
      <p role="status">{message || (busy ? "확인 중…" : "")}</p>
      {pending && <button type="button" disabled={busy} className={buttonClass} onClick={() => void send(pending, true)}>
        반영 여부 조회 후 미반영 시 같은 요청 보내기
      </button>}
    </details>
  );
}
