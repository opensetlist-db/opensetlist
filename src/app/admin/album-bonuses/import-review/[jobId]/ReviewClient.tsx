"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type {
  Classifications,
  Decisions,
  ParsedCandidates,
} from "@/lib/album-bonus-import";

type JobShape = {
  id: string;
  albumId: number | null;
  sourceUrl: string | null;
  notes: string | null;
  status: "pending" | "applied" | "discarded";
  createdAt: string;
  appliedAt: string | null;
  discardedAt: string | null;
  album: {
    id: number;
    originalTitle: string;
    slug: string;
    releaseDate: string | null;
  } | null;
};

type RecentAlbum = {
  id: number;
  originalTitle: string;
  releaseDate: string | null;
};

type Props = {
  job: JobShape;
  candidates: ParsedCandidates;
  classifications: Classifications;
  initialDecisions: Decisions;
  recentAlbums: RecentAlbum[];
};

type Tone = "info" | "success" | "error";

export default function ReviewClient({
  job,
  candidates,
  classifications,
  initialDecisions,
  recentAlbums,
}: Props) {
  const router = useRouter();

  const isPending = job.status === "pending";
  const [albumId, setAlbumId] = useState<string>(
    job.albumId !== null ? String(job.albumId) : "",
  );
  const [sourceUrl, setSourceUrl] = useState<string>(job.sourceUrl ?? "");
  const [notes, setNotes] = useState<string>(job.notes ?? "");
  const [decisions, setDecisions] = useState<Decisions>(initialDecisions);
  const [busy, setBusy] = useState<null | "save" | "apply" | "discard">(null);
  const [toast, setToast] = useState<{ tone: Tone; text: string } | null>(null);

  // Index classifications for cheap row-render lookups. Both maps key
  // on the same indices that the candidates and decisions arrays use.
  const listingClassByIdx = useMemo(() => {
    const m = new Map<number, Classifications["listings"][number]>();
    for (const lc of classifications.listings) m.set(lc.listingIdx, lc);
    return m;
  }, [classifications]);

  const bonusClassByKey = useMemo(() => {
    const m = new Map<string, Classifications["bonuses"][number]>();
    for (const bc of classifications.bonuses) {
      m.set(`${bc.listingIdx}:${bc.bonusIdx}`, bc);
    }
    return m;
  }, [classifications]);

  const summary = useMemo(() => {
    let inserts = 0;
    let updates = 0;
    let noops = 0;
    for (const lc of classifications.listings) {
      if (lc.kind === "insert") inserts++;
      else if (lc.kind === "update-changed") updates++;
      else noops++;
    }
    let bonusInserts = 0;
    for (const bc of classifications.bonuses) {
      if (bc.kind === "insert") bonusInserts++;
    }
    return { inserts, updates, noops, bonusInserts };
  }, [classifications]);

  function setListingApproved(idx: number, approved: boolean) {
    setDecisions((d) => ({
      ...d,
      listings: { ...d.listings, [idx]: { approved } },
    }));
  }
  function setBonusApproved(key: string, approved: boolean) {
    setDecisions((d) => ({
      ...d,
      bonuses: { ...d.bonuses, [key]: { approved } },
    }));
  }
  function setAllListings(approved: boolean) {
    setDecisions((d) => {
      const next = { ...d, listings: { ...d.listings }, bonuses: { ...d.bonuses } };
      for (let i = 0; i < candidates.listings.length; i++) {
        next.listings[i] = { approved };
        const bs = candidates.listings[i].bonuses;
        for (let j = 0; j < bs.length; j++) {
          next.bonuses[`${i}:${j}`] = { approved };
        }
      }
      return next;
    });
  }

  async function onSave() {
    setBusy("save");
    setToast(null);
    const albumIdValue = albumId.trim();
    try {
      const resp = await fetch(`/api/admin/album-bonuses/import/${job.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          albumId: albumIdValue === "" ? null : albumIdValue,
          sourceUrl: sourceUrl.trim() === "" ? null : sourceUrl.trim(),
          notes: notes.trim() === "" ? null : notes.trim(),
          decisions,
        }),
      });
      if (!resp.ok) {
        const body = (await resp.json().catch(() => ({}))) as { error?: string };
        setToast({ tone: "error", text: body.error ?? `저장 실패 (${resp.status})` });
      } else {
        setToast({ tone: "success", text: "저장됨." });
        // Refresh so classifications reflect the new albumId
        router.refresh();
      }
    } catch (e) {
      setToast({
        tone: "error",
        text: e instanceof Error ? e.message : "저장 실패",
      });
    } finally {
      setBusy(null);
    }
  }

  async function onApply() {
    if (!albumId.trim()) {
      setToast({ tone: "error", text: "앨범을 먼저 지정하세요." });
      return;
    }
    if (!confirm("승인된 후보를 적용합니다. 이 작업은 되돌릴 수 없습니다.")) return;
    setBusy("apply");
    setToast(null);
    try {
      const resp = await fetch(
        `/api/admin/album-bonuses/import/${job.id}/apply`,
        { method: "POST" },
      );
      if (!resp.ok) {
        const body = (await resp.json().catch(() => ({}))) as { error?: string };
        setToast({ tone: "error", text: body.error ?? `적용 실패 (${resp.status})` });
        setBusy(null);
        return;
      }
      const body = (await resp.json()) as {
        applied: { listingsInserted: number; listingsUpdated: number; bonusesInserted: number };
      };
      setToast({
        tone: "success",
        text: `적용 완료 — 신규 매장 ${body.applied.listingsInserted}개, 매장 업데이트 ${body.applied.listingsUpdated}개, 신규 특전 ${body.applied.bonusesInserted}개.`,
      });
      router.refresh();
    } catch (e) {
      setToast({
        tone: "error",
        text: e instanceof Error ? e.message : "적용 실패",
      });
    } finally {
      setBusy(null);
    }
  }

  async function onDiscard() {
    if (!confirm("이 작업을 버립니다. 후보 JSON은 사라집니다.")) return;
    setBusy("discard");
    setToast(null);
    try {
      const resp = await fetch(`/api/admin/album-bonuses/import/${job.id}`, {
        method: "DELETE",
      });
      if (!resp.ok) {
        const body = (await resp.json().catch(() => ({}))) as { error?: string };
        setToast({ tone: "error", text: body.error ?? `삭제 실패 (${resp.status})` });
        setBusy(null);
        return;
      }
      router.push("/admin/album-bonuses/import-review");
      router.refresh();
    } catch (e) {
      setToast({
        tone: "error",
        text: e instanceof Error ? e.message : "삭제 실패",
      });
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded border border-zinc-200 bg-white p-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h1 className="text-xl font-bold">임포트 검토</h1>
          <StatusBadge status={job.status} />
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="block text-sm">
            <span className="block text-zinc-600">앨범 ID</span>
            <input
              type="text"
              value={albumId}
              onChange={(e) => setAlbumId(e.target.value)}
              list="recent-albums"
              disabled={!isPending}
              className="mt-1 w-full rounded border border-zinc-300 px-2 py-1 text-sm disabled:bg-zinc-50"
              placeholder="앨범 ID 직접 입력 (목록에서 선택 가능)"
            />
            <datalist id="recent-albums">
              {recentAlbums.map((a) => (
                <option key={a.id} value={String(a.id)}>
                  {a.originalTitle}{a.releaseDate ? ` — ${a.releaseDate.slice(0, 10)}` : ""}
                </option>
              ))}
            </datalist>
            {job.album && (
              <span className="mt-1 block text-xs text-zinc-500">
                현재: {job.album.originalTitle}
              </span>
            )}
            {!job.album && candidates.albumTitleGuess && (
              <span className="mt-1 block text-xs text-amber-700">
                힌트: 「{candidates.albumTitleGuess}」 ({candidates.releaseDateGuess ?? "발매일 미상"})
              </span>
            )}
          </label>

          <label className="block text-sm">
            <span className="block text-zinc-600">소스 URL</span>
            <input
              type="url"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              disabled={!isPending}
              className="mt-1 w-full rounded border border-zinc-300 px-2 py-1 text-sm disabled:bg-zinc-50"
              placeholder="https://www.lovelive-anime.jp/news/…"
            />
          </label>

          <label className="block text-sm md:col-span-2">
            <span className="block text-zinc-600">메모</span>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={!isPending}
              className="mt-1 w-full rounded border border-zinc-300 px-2 py-1 text-sm disabled:bg-zinc-50"
            />
          </label>
        </div>

        {candidates.warnings.length > 0 && (
          <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
            <div className="font-semibold">파서 경고</div>
            <ul className="ml-4 list-disc">
              {candidates.warnings.map((w, idx) => (
                <li key={idx}>{w}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="rounded border border-zinc-200 bg-white p-3">
        <div className="mb-2 flex flex-wrap items-center gap-3 text-xs text-zinc-600">
          <span>신규 매장 <b>{summary.inserts}</b></span>
          <span>매장 업데이트 <b>{summary.updates}</b></span>
          <span>noop <b>{summary.noops}</b></span>
          <span>신규 특전 후보 <b>{summary.bonusInserts}</b></span>
          {classifications.unreferencedListings.length > 0 && (
            <span className="text-zinc-500">
              본 페이지에 없는 기존 매장 <b>{classifications.unreferencedListings.length}</b>
            </span>
          )}
          {isPending && (
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={() => setAllListings(true)}
                className="text-blue-600 hover:underline"
              >
                모두 승인
              </button>
              <button
                type="button"
                onClick={() => setAllListings(false)}
                className="text-blue-600 hover:underline"
              >
                모두 해제
              </button>
            </div>
          )}
        </div>

        <div className="space-y-2">
          {candidates.listings.map((listing, idx) => {
            const lc = listingClassByIdx.get(idx)!;
            const decision = decisions.listings[idx];
            const approved = decision?.approved === true;
            return (
              <div
                key={idx}
                className="rounded border border-zinc-200 bg-zinc-50/50 p-2"
              >
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={approved}
                    onChange={(e) => setListingApproved(idx, e.target.checked)}
                    disabled={!isPending}
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="font-medium">
                        {listing.originalStoreName}
                      </span>
                      <ClassificationBadge kind={lc.kind} />
                      {listing.originalEditionLabel && (
                        <span className="text-xs text-zinc-500">
                          ({listing.originalEditionLabel})
                        </span>
                      )}
                    </div>
                    {lc.diffs.length > 0 && (
                      <div className="mt-1 text-xs text-amber-700">
                        {lc.diffs.map((d, di) => (
                          <div key={di}>
                            <code>{d.field}</code>: {d.from ?? "(없음)"} → {d.to ?? "(없음)"}
                          </div>
                        ))}
                      </div>
                    )}
                    {listing.productUrl && (
                      <a
                        href={listing.productUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 block max-w-[40rem] truncate text-xs text-blue-600 hover:underline"
                      >
                        {listing.productUrl}
                      </a>
                    )}
                  </div>
                </label>

                <div className="mt-2 ml-6 space-y-1">
                  {listing.bonuses.map((bonus, bonusIdx) => {
                    const key = `${idx}:${bonusIdx}`;
                    const bc = bonusClassByKey.get(key)!;
                    const bd = decisions.bonuses[key];
                    const bonusApproved = bd?.approved === true;
                    return (
                      <label
                        key={key}
                        className="flex items-start gap-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={bonusApproved}
                          onChange={(e) =>
                            setBonusApproved(key, e.target.checked)
                          }
                          disabled={!isPending}
                          className="mt-1"
                        />
                        <div className="flex-1">
                          <div className="flex items-baseline gap-2">
                            <span>{bonus.originalBonusType}</span>
                            <ClassificationBadge kind={bc.kind} />
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {classifications.unreferencedListings.length > 0 && (
          <div className="mt-3 rounded border border-zinc-200 bg-zinc-50 p-2 text-xs">
            <div className="mb-1 font-semibold text-zinc-700">
              본 페이지에 없는 기존 매장 (참고용 — 변경되지 않음)
            </div>
            <ul className="ml-4 list-disc text-zinc-500">
              {classifications.unreferencedListings.map((u) => (
                <li key={u.listingId}>{u.originalStoreName}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {toast && (
        <div
          className={
            "rounded border px-3 py-2 text-sm " +
            (toast.tone === "error"
              ? "border-red-200 bg-red-50 text-red-700"
              : toast.tone === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-zinc-200 bg-zinc-50 text-zinc-700")
          }
        >
          {toast.text}
        </div>
      )}

      {isPending && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onSave}
            disabled={busy !== null}
            className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy === "save" ? "저장 중…" : "결정 저장"}
          </button>
          <button
            type="button"
            onClick={onApply}
            disabled={busy !== null}
            className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy === "apply" ? "적용 중…" : "승인된 후보 적용"}
          </button>
          <button
            type="button"
            onClick={onDiscard}
            disabled={busy !== null}
            className="ml-auto rounded border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            {busy === "discard" ? "삭제 중…" : "버리기"}
          </button>
        </div>
      )}
    </div>
  );
}

function StatusBadge({
  status,
}: {
  status: "pending" | "applied" | "discarded";
}) {
  const map = {
    pending: { label: "검토 대기", cls: "bg-amber-100 text-amber-800" },
    applied: { label: "적용됨", cls: "bg-emerald-100 text-emerald-800" },
    discarded: { label: "버려짐", cls: "bg-zinc-200 text-zinc-700" },
  } as const;
  const m = map[status];
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${m.cls}`}>
      {m.label}
    </span>
  );
}

function ClassificationBadge({ kind }: { kind: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    insert: { label: "신규", cls: "bg-blue-100 text-blue-700" },
    "update-changed": { label: "변경", cls: "bg-amber-100 text-amber-700" },
    "update-noop": { label: "noop", cls: "bg-zinc-100 text-zinc-600" },
  };
  const m = map[kind] ?? { label: kind, cls: "bg-zinc-100 text-zinc-600" };
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${m.cls}`}>
      {m.label}
    </span>
  );
}
