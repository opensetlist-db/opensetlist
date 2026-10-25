"use client";

import { useEffect, useState } from "react";

type Artist = { artistId: string; label: string; included: boolean };

export default function CollaborationSettings({ eventId }: { eventId: number }) {
  const [artists, setArtists] = useState<Artist[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/admin/events/${eventId}/collaborations`);
        const body: { artists?: Artist[]; error?: string } | null = await response.json();
        if (!response.ok || !body || !Array.isArray(body.artists)) {
          throw new Error(body?.error ?? "협업 그룹 설정을 불러오지 못했습니다.");
        }
        if (!cancelled) setArtists(body.artists);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "설정을 불러오지 못했습니다.");
      }
    })();
    return () => { cancelled = true; };
  }, [eventId, reload]);

  async function save() {
    if (!artists) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const response = await fetch(`/api/admin/events/${eventId}/collaborations`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ artistIds: artists.filter((artist) => artist.included).map((artist) => artist.artistId) }),
      });
      const body: { error?: string } | null = await response.json();
      if (!response.ok || !body) throw new Error(body?.error ?? "설정을 저장하지 못했습니다.");
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "설정을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4" data-testid="collaboration-settings">
      <p className="text-sm text-zinc-500">
        합동 공연의 예상 세트리스트 곡 선택에 포함할 협업 그룹을 직접 지정합니다.
        멤버의 다른 소속만으로 협업 그룹을 자동 추가하지 않습니다. 팬 보드에는 별도 열이 생기지 않습니다.
      </p>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {artists === null ? (
        error ? <button type="button" onClick={() => {
          setError(null);
          setSaved(false);
          setReload((value) => value + 1);
        }}>다시 불러오기</button>
          : <p className="text-sm text-zinc-500">협업 그룹 설정 불러오는 중…</p>
      ) : (
        <fieldset disabled={saving} className="space-y-3">
          <legend className="sr-only">포함할 협업 그룹</legend>
          {artists.length === 0 && <p className="text-sm text-zinc-500">등록된 협업 그룹이 없습니다.</p>}
          {artists.map((artist) => (
            <label key={artist.artistId} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={artist.included} onChange={(event) => {
                setArtists((current) => current?.map((item) => item.artistId === artist.artistId ? { ...item, included: event.target.checked } : item) ?? null);
                setSaved(false);
              }} />
              {artist.label}
            </label>
          ))}
          <button type="button" onClick={save} className="rounded bg-zinc-900 px-4 py-2 text-sm text-white disabled:opacity-50">
            {saving ? "저장 중…" : "협업 그룹 저장"}
          </button>
          {saved && <p role="status" className="text-sm text-zinc-500">저장했습니다. 공개 페이지를 새로고침해 확인해 주세요.</p>}
        </fieldset>
      )}
    </div>
  );
}
