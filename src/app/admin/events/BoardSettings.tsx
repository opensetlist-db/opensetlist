"use client";

// Fan board settings (n15): the per-event flag + operator starter
// picks. Korean-only per CLAUDE.md's admin exemption, like EventForm.
//
// Saves through its own endpoint (`/api/admin/events/[id]/board`), NOT
// the event form's PUT: that save runs in the live writer transaction
// and expires the event + global caches; board settings must do
// neither. Changes reach the public page within the event-row TTL
// (~60 s), which the hint below states so the operator doesn't
// "fix" a save that simply hasn't propagated yet.

import { useEffect, useRef, useState } from "react";

const MAX_PER_GROUP = 3;

interface Starter {
  songId: string;
  title: string;
  inCatalog: boolean;
}

interface Group {
  groupId: string;
  label: string;
  color: string | null;
  starters: Starter[];
}

interface SearchHit {
  songId: string;
  title: string;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready" };

export default function BoardSettings({ eventId }: { eventId: number }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [enabled, setEnabled] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/admin/events/${eventId}/board`);
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setState({ kind: "error", message: body.error ?? `HTTP ${res.status}` });
          return;
        }
        setEnabled(body.boardEnabled);
        setGroups(body.groups);
        setState({ kind: "ready" });
      } catch {
        if (!cancelled) {
          setState({ kind: "error", message: "보드 설정을 불러오지 못했습니다." });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  function setGroupStarters(groupId: string, next: Starter[]) {
    setGroups((gs) =>
      gs.map((g) => (g.groupId === groupId ? { ...g, starters: next } : g)),
    );
    setSavedAt(null);
  }

  async function save() {
    setSaving(true);
    try {
      const starterSongIds: Record<string, string[]> = {};
      for (const g of groups) {
        if (g.starters.length > 0) {
          starterSongIds[g.groupId] = g.starters.map((s) => s.songId);
        }
      }
      const res = await fetch(`/api/admin/events/${eventId}/board`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boardEnabled: enabled, starterSongIds }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(body.error ?? `저장 실패 (HTTP ${res.status})`);
        return;
      }
      setSavedAt(new Date().toISOString().slice(11, 19));
    } catch {
      alert("저장에 실패했습니다. 네트워크를 확인해 주세요.");
    } finally {
      setSaving(false);
    }
  }

  if (state.kind === "loading") {
    return <p className="text-sm text-zinc-500">팬 보드 설정 불러오는 중…</p>;
  }
  if (state.kind === "error") {
    return <p className="text-sm text-red-600">{state.message}</p>;
  }

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            setEnabled(e.target.checked);
            setSavedAt(null);
          }}
        />
        팬 보드 사용
      </label>
      <p className="text-xs text-zinc-500">
        저장 후 공개 페이지 반영까지 최대 약 1분. 공연 진행 중에는 보드가 표시되지
        않습니다(기존 희망곡 표시 유지). 끄면 쓰기도 서버에서 차단됩니다.
      </p>

      {groups.length === 0 ? (
        <p className="text-sm text-zinc-500">
          보드 그룹이 없습니다 — 시리즈 아티스트 또는 출연자(로스터)를 먼저
          등록하세요.
        </p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm font-medium">
            운영자 추천곡 (그룹당 0–{MAX_PER_GROUP}곡, 팬 제출이 0건인 칸에만 표시·집계 제외)
          </p>
          {groups.map((g) => (
            <GroupStarterEditor
              key={g.groupId}
              eventId={eventId}
              group={g}
              onChange={(next) => setGroupStarters(g.groupId, next)}
            />
          ))}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded bg-zinc-900 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {saving ? "저장 중…" : "팬 보드 설정 저장"}
        </button>
        {savedAt && <span className="text-xs text-green-700">저장됨 ({savedAt} UTC)</span>}
      </div>
    </div>
  );
}

function GroupStarterEditor({
  eventId,
  group,
  onChange,
}: {
  eventId: number;
  group: Group;
  onChange: (next: Starter[]) => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const seq = useRef(0);
  const full = group.starters.length >= MAX_PER_GROUP;

  const active = q.trim() !== "" && !full;
  // Stale hits from a previous query are hidden rather than cleared in
  // the effect (no synchronous setState there).
  const visibleHits = active ? hits : [];

  useEffect(() => {
    // Debounced, and `seq` drops responses that arrive out of order
    // so a slow earlier query can't overwrite a newer one's results
    // (bumped even when idle, so a response for a cleared box drops).
    const mySeq = ++seq.current;
    if (!active) return;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const params = new URLSearchParams({ groupId: group.groupId, q });
        const res = await fetch(
          `/api/admin/events/${eventId}/board/songs?${params}`,
        );
        const body = await res.json();
        if (mySeq === seq.current) setHits(res.ok ? body.songs : []);
      } catch {
        if (mySeq === seq.current) setHits([]);
      } finally {
        if (mySeq === seq.current) setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [q, active, eventId, group.groupId]);

  const chosen = new Set(group.starters.map((s) => s.songId));

  return (
    <div className="rounded border border-zinc-200 p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        <span
          className="inline-block h-3 w-3 rounded-full"
          style={{ background: group.color ?? "#999" }}
        />
        {group.label}
        <span className="text-xs text-zinc-500">
          ({group.starters.length}/{MAX_PER_GROUP})
        </span>
      </div>
      {group.starters.length === 0 ? (
        <p className="mb-2 text-xs text-zinc-500">추천곡 없음 — 공개 보드에는 참여 안내만 표시됩니다.</p>
      ) : (
        <ul className="mb-2 space-y-1">
          {group.starters.map((s) => (
            <li key={s.songId} className="flex items-center gap-2 text-sm">
              <span className={s.inCatalog ? "" : "text-red-600"}>
                {s.title}
                {!s.inCatalog && " (목록에 없음 — 공개 보드에서 제외됨, 삭제 필요)"}
              </span>
              <button
                type="button"
                onClick={() =>
                  onChange(group.starters.filter((x) => x.songId !== s.songId))
                }
                className="text-xs text-zinc-500 underline"
              >
                삭제
              </button>
            </li>
          ))}
        </ul>
      )}
      {full ? (
        <p className="text-xs text-zinc-500">최대 {MAX_PER_GROUP}곡까지입니다.</p>
      ) : (
        <div>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`${group.label} 기본곡 검색`}
            className="w-full rounded border border-zinc-300 px-3 py-1.5 text-sm"
          />
          {searching && <p className="mt-1 text-xs text-zinc-500">검색 중…</p>}
          {visibleHits.length > 0 && (
            <ul className="mt-1 max-h-48 overflow-y-auto rounded border border-zinc-200">
              {visibleHits.map((h) => (
                <li key={h.songId}>
                  <button
                    type="button"
                    disabled={chosen.has(h.songId)}
                    onClick={() => {
                      onChange([
                        ...group.starters,
                        { songId: h.songId, title: h.title, inCatalog: true },
                      ]);
                      setQ("");
                    }}
                    className="block w-full px-3 py-1.5 text-left text-sm hover:bg-zinc-100 disabled:text-zinc-400"
                  >
                    {h.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
