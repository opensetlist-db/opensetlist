"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

type SongOption = {
  id: number;
  originalTitle: string;
  translations: { locale: string; title: string }[];
};

type StageIdentityOption = {
  id: string;
  translations: { locale: string; name: string }[];
  artistLinks: {
    artist: { translations: { locale: string; name: string }[] };
  }[];
};

type SetlistItemData = {
  id: number;
  position: number;
  isEncore: boolean;
  stageType: string;
  unitName: string | null;
  note: string | null;
  status: string;
  performanceType: string;
  type: string;
  songs: {
    song: {
      id: number;
      originalTitle: string;
      translations: { locale: string; title: string }[];
    };
  }[];
  performers: {
    stageIdentity: {
      id: string;
      translations: { locale: string; name: string }[];
    };
  }[];
};

const STAGE_TYPES = ["full_group", "unit", "solo", "special"];
const ITEM_STATUSES = ["confirmed", "live", "rumoured"];
const PERFORMANCE_TYPES = ["live_performance", "virtual_live", "video_playback"];
const ITEM_TYPES = ["song", "mc", "video", "interval"];

function getSongName(song: SongOption | SetlistItemData["songs"][0]["song"]) {
  return (
    song.translations.find((t) => t.locale === "ko")?.title ??
    song.originalTitle
  );
}

function getSIName(si: { translations: { locale: string; name: string }[] }) {
  return si.translations.find((t) => t.locale === "ko")?.name ?? "Unknown";
}

export default function SetlistBuilder({
  eventId,
  initialItems,
}: {
  eventId: number;
  initialItems: SetlistItemData[];
}) {
  const router = useRouter();
  const [items, setItems] = useState<SetlistItemData[]>(initialItems);
  const [songs, setSongs] = useState<SongOption[]>([]);
  const [stageIdentities, setStageIdentities] = useState<
    StageIdentityOption[]
  >([]);
  const [loading, setLoading] = useState(false);

  // New item form state
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formPosition, setFormPosition] = useState(items.length + 1);
  const [formIsEncore, setFormIsEncore] = useState(false);
  const [formStageType, setFormStageType] = useState("full_group");
  const [formUnitName, setFormUnitName] = useState("");
  const [formNote, setFormNote] = useState("");
  const [formStatus, setFormStatus] = useState("confirmed");
  const [formPerformanceType, setFormPerformanceType] = useState("live_performance");
  const [formType, setFormType] = useState("song");
  const [formSongIds, setFormSongIds] = useState<number[]>([]);
  const [formPerformerIds, setFormPerformerIds] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/admin/songs")
      .then((r) => r.json())
      .then(setSongs);
    fetch("/api/admin/stage-identities")
      .then((r) => r.json())
      .then(setStageIdentities);
  }, []);

  function resetForm() {
    setEditingId(null);
    setFormPosition(items.length + 1);
    setFormIsEncore(false);
    setFormStageType("full_group");
    setFormUnitName("");
    setFormNote("");
    setFormStatus("confirmed");
    setFormPerformanceType("live_performance");
    setFormType("song");
    setFormSongIds([]);
    setFormPerformerIds([]);
  }

  function startEdit(item: SetlistItemData) {
    setEditingId(item.id);
    setFormPosition(item.position);
    setFormIsEncore(item.isEncore);
    setFormStageType(item.stageType);
    setFormUnitName(item.unitName ?? "");
    setFormNote(item.note ?? "");
    setFormStatus(item.status);
    setFormPerformanceType(item.performanceType ?? "live_performance");
    setFormType(item.type ?? "song");
    setFormSongIds(item.songs.map((s) => s.song.id));
    setFormPerformerIds(item.performers.map((p) => p.stageIdentity.id));
    setShowForm(true);
  }

  async function handleSave() {
    setLoading(true);
    const payload = {
      eventId,
      position: formPosition,
      isEncore: formIsEncore,
      stageType: formStageType,
      unitName: formUnitName || null,
      note: formNote || null,
      status: formStatus,
      performanceType: formPerformanceType,
      type: formType,
      songIds: formType === "song" ? formSongIds : [],
      performerIds: formPerformerIds,
    };

    const url = editingId
      ? `/api/admin/setlist-items/${editingId}`
      : "/api/admin/setlist-items";
    const method = editingId ? "PUT" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      resetForm();
      setShowForm(false);
      router.refresh();
      // Reload items
      const eventRes = await fetch(`/api/admin/events/${eventId}`);
      const eventData = await eventRes.json();
      setItems(eventData.setlistItems);
    } else {
      alert("저장에 실패했습니다.");
    }
    setLoading(false);
  }

  async function handleDelete(itemId: number) {
    if (!confirm("삭제하시겠습니까?")) return;
    const res = await fetch(`/api/admin/setlist-items/${itemId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setItems((prev) => prev.filter((i) => i.id !== itemId));
    }
  }

  function toggleSong(songId: number) {
    setFormSongIds((prev) =>
      prev.includes(songId)
        ? prev.filter((id) => id !== songId)
        : [...prev, songId]
    );
  }

  function togglePerformer(siId: string) {
    setFormPerformerIds((prev) =>
      prev.includes(siId)
        ? prev.filter((id) => id !== siId)
        : [...prev, siId]
    );
  }

  return (
    <div>
      {/* Existing items */}
      {items.length > 0 && (
        <ol className="mb-6 space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-start gap-3 rounded border border-zinc-200 bg-white p-3"
            >
              <span className="mt-0.5 w-6 shrink-0 text-right font-mono text-sm text-zinc-400">
                {item.position}
              </span>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  {item.isEncore && (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">
                      앙코르
                    </span>
                  )}
                  {item.type && item.type !== "song" && (
                    <span className="rounded bg-purple-100 px-1.5 py-0.5 text-xs text-purple-700">
                      {item.type.toUpperCase()}
                    </span>
                  )}
                  {item.performanceType === "virtual_live" && (
                    <span className="rounded bg-cyan-100 px-1.5 py-0.5 text-xs text-cyan-700">
                      3D
                    </span>
                  )}
                  {item.performanceType === "video_playback" && (
                    <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-xs text-zinc-600">
                      영상
                    </span>
                  )}
                  {item.songs.map((s, i) => (
                    <span key={s.song.id}>
                      {i > 0 && <span className="text-zinc-400"> + </span>}
                      <span className="font-medium">
                        {getSongName(s.song)}
                      </span>
                    </span>
                  ))}
                  {item.songs.length === 0 && (!item.type || item.type === "song") && (
                    <span className="text-zinc-400">곡 미지정</span>
                  )}
                  {item.songs.length === 0 && item.type && item.type !== "song" && item.note && (
                    <span className="text-zinc-500">{item.note}</span>
                  )}
                </div>
                <div className="mt-1 text-sm text-zinc-500">
                  {item.stageType !== "full_group" && (
                    <span className="mr-2 rounded bg-zinc-100 px-1.5 py-0.5 text-xs">
                      {item.unitName ?? item.stageType}
                    </span>
                  )}
                  {item.performers
                    .map((p) => getSIName(p.stageIdentity))
                    .join(", ")}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => startEdit(item)}
                  className="text-sm text-blue-600 hover:underline"
                >
                  편집
                </button>
                <button
                  onClick={() => handleDelete(item.id)}
                  className="text-sm text-red-500 hover:underline"
                >
                  삭제
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}

      {/* Add / Edit form */}
      {!showForm ? (
        <button
          onClick={() => {
            resetForm();
            setFormPosition(items.length + 1);
            setShowForm(true);
          }}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
        >
          + 세트리스트 항목 추가
        </button>
      ) : (
        <div className="rounded border border-zinc-200 bg-white p-4 space-y-4">
          <h3 className="font-semibold">
            {editingId ? "항목 편집" : "새 항목"}
          </h3>

          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium">순서</label>
              <input
                type="number"
                min={1}
                value={formPosition}
                onChange={(e) => setFormPosition(Number(e.target.value))}
                className="w-full rounded border border-zinc-300 px-2 py-1 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">
                스테이지 타입
              </label>
              <select
                value={formStageType}
                onChange={(e) => setFormStageType(e.target.value)}
                className="w-full rounded border border-zinc-300 px-2 py-1 text-sm"
              >
                {STAGE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">상태</label>
              <select
                value={formStatus}
                onChange={(e) => setFormStatus(e.target.value)}
                className="w-full rounded border border-zinc-300 px-2 py-1 text-sm"
              >
                {ITEM_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={formIsEncore}
                  onChange={(e) => setFormIsEncore(e.target.checked)}
                />
                앙코르
              </label>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium">항목 유형</label>
              <select
                value={formType}
                onChange={(e) => setFormType(e.target.value)}
                className="w-full rounded border border-zinc-300 px-2 py-1 text-sm"
              >
                {ITEM_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">공연 유형</label>
              <select
                value={formPerformanceType}
                onChange={(e) => setFormPerformanceType(e.target.value)}
                className="w-full rounded border border-zinc-300 px-2 py-1 text-sm"
              >
                {PERFORMANCE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium">
                유닛명 (선택)
              </label>
              <input
                placeholder="Cerise Bouquet"
                value={formUnitName}
                onChange={(e) => setFormUnitName(e.target.value)}
                className="w-full rounded border border-zinc-300 px-2 py-1 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">
                메모 (선택)
              </label>
              <input
                placeholder="게스트 출연"
                value={formNote}
                onChange={(e) => setFormNote(e.target.value)}
                className="w-full rounded border border-zinc-300 px-2 py-1 text-sm"
              />
            </div>
          </div>

          {/* Song selector — only for song type */}
          {formType === "song" && <div>
            <label className="mb-1 block text-xs font-medium">
              곡 (복수 선택 = 메들리)
            </label>
            <div className="max-h-40 overflow-y-auto rounded border border-zinc-200 p-2">
              {songs.map((song) => (
                <label
                  key={song.id}
                  className="flex items-center gap-2 py-0.5 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={formSongIds.includes(song.id)}
                    onChange={() => toggleSong(song.id)}
                  />
                  {getSongName(song)}
                </label>
              ))}
              {songs.length === 0 && (
                <p className="text-xs text-zinc-400">
                  곡을 먼저 등록해주세요.
                </p>
              )}
            </div>
          </div>}

          {/* Performer selector */}
          <div>
            <label className="mb-1 block text-xs font-medium">출연진</label>
            <div className="max-h-40 overflow-y-auto rounded border border-zinc-200 p-2">
              {stageIdentities.map((si) => {
                const artistName = si.artistLinks[0]
                  ? (si.artistLinks[0].artist.translations.find(
                      (t) => t.locale === "ko"
                    )?.name ?? "")
                  : "";
                return (
                  <label
                    key={si.id}
                    className="flex items-center gap-2 py-0.5 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={formPerformerIds.includes(si.id)}
                      onChange={() => togglePerformer(si.id)}
                    />
                    {getSIName(si)}
                    {artistName && (
                      <span className="text-xs text-zinc-400">
                        ({artistName})
                      </span>
                    )}
                  </label>
                );
              })}
              {stageIdentities.length === 0 && (
                <p className="text-xs text-zinc-400">
                  아티스트에 멤버를 먼저 등록해주세요.
                </p>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={loading}
              className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? "저장 중..." : "저장"}
            </button>
            <button
              onClick={() => {
                setShowForm(false);
                resetForm();
              }}
              className="rounded border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50"
            >
              취소
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
