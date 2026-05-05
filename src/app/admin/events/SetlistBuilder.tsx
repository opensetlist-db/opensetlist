"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { matchesIdentitySearch } from "@/lib/search";
import { ADMIN_UNKNOWN_NAME } from "@/lib/admin-constants";
import { nextSetlistPosition } from "@/lib/setlist-position";
import { SongSearch, type SongSearchResult } from "@/components/SongSearch";

type SongOption = {
  id: number;
  originalTitle: string;
  variantLabel?: string | null;
  translations: { locale: string; title: string; variantLabel?: string | null }[];
  artists?: {
    artist: {
      translations: { locale: string; name: string; shortName?: string | null }[];
    };
  }[];
};

type StageIdentityOption = {
  id: string;
  translations: { locale: string; name: string }[];
  artistLinks: {
    artist: { translations: { locale: string; name: string }[] };
  }[];
};

type ArtistOption = {
  id: number;
  translations: { locale: string; name: string }[];
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
      translations: { locale: string; title: string; variantLabel?: string | null }[];
    };
  }[];
  performers: {
    stageIdentity: {
      id: string;
      translations: { locale: string; name: string }[];
    };
  }[];
  artists: {
    artist: {
      id: number;
      translations: { locale: string; name: string }[];
    };
  }[];
};

const STAGE_TYPES = ["full_group", "unit", "solo", "special"];
const ITEM_STATUSES = ["confirmed", "live", "rumoured"];
const PERFORMANCE_TYPES = ["live_performance", "virtual_live", "video_playback"];
const ITEM_TYPES = ["song", "mc", "video", "interval"];

function getSongName(song: SongOption | SetlistItemData["songs"][0]["song"]) {
  const title =
    song.translations.find((t) => t.locale === "ko")?.title ??
    song.originalTitle;
  const koVariant = song.translations.find((t) => t.locale === "ko")?.variantLabel;
  const resolvedVariant = koVariant || ("variantLabel" in song ? song.variantLabel : null);
  const variant = resolvedVariant ? ` (${resolvedVariant})` : "";
  const artist =
    "artists" in song && song.artists?.[0]
      ? song.artists[0].artist.translations.find((t) => t.locale === "ko")?.shortName ??
        song.artists[0].artist.translations.find((t) => t.locale === "ko")?.name ??
        song.artists[0].artist.translations[0]?.shortName ??
        song.artists[0].artist.translations[0]?.name
      : null;
  const artistSuffix = artist ? ` — ${artist}` : "";
  return `${title}${variant}${artistSuffix}`;
}

function getSIName(si: { translations: { locale: string; name: string }[] }) {
  return si.translations.find((t) => t.locale === "ko")?.name ?? ADMIN_UNKNOWN_NAME;
}

function getArtistName(a: { translations: { locale: string; name: string }[] }) {
  return a.translations.find((t) => t.locale === "ko")?.name ?? ADMIN_UNKNOWN_NAME;
}

export default function SetlistBuilder({
  eventId,
  initialItems,
  eventPerformers,
}: {
  eventId: number;
  initialItems: SetlistItemData[];
  // Non-guest performers from EventPerformer; pre-selected on every
  // fresh new-item form so operators deselect rather than add.
  eventPerformers: StageIdentityOption[];
}) {
  const router = useRouter();
  const [items, setItems] = useState<SetlistItemData[]>(initialItems);
  const [songs, setSongs] = useState<SongOption[]>([]);
  const [stageIdentities, setStageIdentities] = useState<
    StageIdentityOption[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [reorderLoading, setReorderLoading] = useState(false);

  // New item form state
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formPosition, setFormPosition] = useState(nextSetlistPosition(items));
  const [formIsEncore, setFormIsEncore] = useState(false);
  const [formStageType, setFormStageType] = useState("full_group");
  const [formUnitName, setFormUnitName] = useState("");
  const [formNote, setFormNote] = useState("");
  const [formStatus, setFormStatus] = useState("confirmed");
  const [formPerformanceType, setFormPerformanceType] = useState("live_performance");
  const [formType, setFormType] = useState("song");
  const [formSongIds, setFormSongIds] = useState<number[]>([]);
  const [formPerformerIds, setFormPerformerIds] = useState<string[]>([]);
  const [formArtistIds, setFormArtistIds] = useState<number[]>([]);

  // Search-based selectors
  // Song search is owned by <SongSearch> — SetlistBuilder only keeps
  // the list of songs the operator has already picked into this row,
  // for tag display + form submission.
  const [selectedSongs, setSelectedSongs] = useState<SongOption[]>([]);

  const [performerSearch, setPerformerSearch] = useState("");
  const [performerDropdownOpen, setPerformerDropdownOpen] = useState(false);
  const [selectedPerformers, setSelectedPerformers] = useState<StageIdentityOption[]>([]);
  const performerSearchRef = useRef<HTMLDivElement>(null);

  const [artistSearch, setArtistSearch] = useState("");
  const [artistSearchResults, setArtistSearchResults] = useState<ArtistOption[]>([]);
  const [artistSearchLoading, setArtistSearchLoading] = useState(false);
  const [artistDropdownOpen, setArtistDropdownOpen] = useState(false);
  const [selectedArtists, setSelectedArtists] = useState<ArtistOption[]>([]);
  const artistSearchRef = useRef<HTMLDivElement>(null);
  const artistSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch("/api/admin/songs")
      .then((r) => r.json())
      .then(setSongs);
    fetch("/api/admin/stage-identities")
      .then((r) => r.json())
      .then(setStageIdentities);
  }, []);

  // Click-outside handlers for dropdowns. SongSearch owns its own
  // click-outside; this only covers the performer + artist pickers,
  // which still use the inline-dropdown pattern.
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (performerSearchRef.current && !performerSearchRef.current.contains(e.target as Node)) {
        setPerformerDropdownOpen(false);
      }
      if (artistSearchRef.current && !artistSearchRef.current.contains(e.target as Node)) {
        setArtistDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function selectSong(song: SongSearchResult) {
    if (formSongIds.includes(song.id)) return;
    setFormSongIds((prev) => [...prev, song.id]);
    // Project of SongSearchResult down to the SongOption shape that
    // the rest of SetlistBuilder + getSongName already understand.
    // Explicit construction (vs. a structural cast) means a future
    // change to either type fails at the right line instead of
    // silently propagating undefined fields.
    const asOption: SongOption = {
      id: song.id,
      originalTitle: song.originalTitle,
      variantLabel: song.variantLabel,
      translations: song.translations,
      artists: song.artists.map((a) => ({
        artist: { translations: a.artist.translations },
      })),
    };
    setSelectedSongs((prev) => [...prev, asOption]);
  }

  function removeSong(songId: number) {
    setFormSongIds((prev) => prev.filter((id) => id !== songId));
    setSelectedSongs((prev) => prev.filter((s) => s.id !== songId));
  }

  function getFilteredPerformers() {
    if (!performerSearch.trim()) return stageIdentities;
    return stageIdentities.filter((si) => matchesIdentitySearch(si, performerSearch));
  }

  function selectPerformer(si: StageIdentityOption) {
    if (!formPerformerIds.includes(si.id)) {
      setFormPerformerIds((prev) => [...prev, si.id]);
      setSelectedPerformers((prev) => [...prev, si]);
    }
    setPerformerSearch("");
  }

  function removePerformer(siId: string) {
    setFormPerformerIds((prev) => prev.filter((id) => id !== siId));
    setSelectedPerformers((prev) => prev.filter((p) => p.id !== siId));
  }

  const searchArtists = useCallback((query: string) => {
    if (artistSearchTimerRef.current) clearTimeout(artistSearchTimerRef.current);
    if (!query.trim()) {
      setArtistSearchResults([]);
      setArtistSearchLoading(false);
      return;
    }
    setArtistSearchLoading(true);
    artistSearchTimerRef.current = setTimeout(async () => {
      const res = await fetch(`/api/admin/artists?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      setArtistSearchResults(data);
      setArtistSearchLoading(false);
    }, 300);
  }, []);

  function handleArtistSearchChange(value: string) {
    setArtistSearch(value);
    setArtistDropdownOpen(true);
    searchArtists(value);
  }

  function selectArtist(artist: ArtistOption) {
    if (!formArtistIds.includes(artist.id)) {
      setFormArtistIds((prev) => [...prev, artist.id]);
      setSelectedArtists((prev) => [...prev, artist]);
    }
    setArtistSearch("");
    setArtistSearchResults([]);
  }

  function removeArtist(artistId: number) {
    setFormArtistIds((prev) => prev.filter((id) => id !== artistId));
    setSelectedArtists((prev) => prev.filter((a) => a.id !== artistId));
  }

  function resetForm() {
    setEditingId(null);
    setFormPosition(nextSetlistPosition(items));
    setFormIsEncore(false);
    setFormStageType("full_group");
    setFormUnitName("");
    setFormNote("");
    setFormStatus("confirmed");
    setFormPerformanceType("live_performance");
    setFormType("song");
    setFormSongIds([]);
    // Default new items to the full non-guest event roster — see the
    // SetlistBuilder prop comment. startEdit() intentionally bypasses
    // this path so editing an existing item doesn't silently re-seed
    // a deliberately-empty performer list.
    setFormPerformerIds(eventPerformers.map((p) => p.id));
    setSelectedSongs([]);
    setPerformerSearch("");
    setSelectedPerformers(eventPerformers);
    setFormArtistIds([]);
    setArtistSearch("");
    setArtistSearchResults([]);
    setSelectedArtists([]);
  }

  async function reloadItems() {
    const eventRes = await fetch(`/api/admin/events/${eventId}`);
    if (!eventRes.ok) return;
    const eventData = await eventRes.json();
    if (Array.isArray(eventData.setlistItems)) {
      setItems(eventData.setlistItems);
    }
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
    setSelectedSongs(item.songs.map((s) => s.song));
    setFormPerformerIds(item.performers.map((p) => p.stageIdentity.id));
    setSelectedPerformers(
      item.performers.map((p) => ({
        id: p.stageIdentity.id,
        translations: p.stageIdentity.translations,
        artistLinks: [],
      }))
    );
    setFormArtistIds(item.artists?.map((a) => a.artist.id) ?? []);
    setSelectedArtists(item.artists?.map((a) => a.artist) ?? []);
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
      artistIds: formArtistIds,
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
      await reloadItems();
    } else {
      const errData = await res.json().catch(() => null);
      alert(errData?.error || "저장에 실패했습니다.");
    }
    setLoading(false);
  }

  async function handleDelete(itemId: number) {
    if (!confirm("삭제하시겠습니까? (소프트 삭제 — 복구 가능)")) return;
    const res = await fetch(`/api/admin/setlist-items/${itemId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setItems((prev) => prev.filter((i) => i.id !== itemId));
    }
  }

  async function handleSwap(itemA: SetlistItemData, itemB: SetlistItemData) {
    setReorderLoading(true);
    try {
      const res = await fetch("/api/admin/setlist-items/swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIdA: itemA.id, itemIdB: itemB.id }),
      });
      if (res.ok) {
        setItems((prev) => {
          const next = prev.map((item) => {
            if (item.id === itemA.id) return { ...item, position: itemB.position };
            if (item.id === itemB.id) return { ...item, position: itemA.position };
            return item;
          });
          return next.sort((a, b) => a.position - b.position);
        });
      } else {
        const err = await res.json().catch(() => null);
        alert(err?.error || "순서 변경에 실패했습니다.");
      }
    } finally {
      setReorderLoading(false);
    }
  }

  async function handleInsertAfter(afterPosition: number) {
    setReorderLoading(true);
    try {
      const res = await fetch("/api/admin/setlist-items/insert-after", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId, afterPosition }),
      });
      if (res.ok) {
        const newItem = await res.json();
        await reloadItems();
        startEdit(newItem);
      } else {
        const err = await res.json().catch(() => null);
        alert(err?.error || "삽입에 실패했습니다.");
      }
    } finally {
      setReorderLoading(false);
    }
  }

  return (
    <div>
      {/* Existing items */}
      {items.length > 0 && (
        <ol className="mb-6 space-y-1">
          <div className="flex justify-center py-0.5">
            <button
              type="button"
              onClick={() => handleInsertAfter(0)}
              disabled={reorderLoading}
              className="text-xs text-zinc-300 hover:text-blue-500 disabled:opacity-30"
            >
              + 맨 앞에 삽입
            </button>
          </div>
          {items.map((item, idx) => (
            <li key={item.id}>
              <div className="flex items-start gap-3 rounded border border-zinc-200 bg-white p-3">
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
                    {item.artists.length > 0 && (
                      <span className="mr-2">
                        {item.artists.map((a, i) => (
                          <span key={a.artist.id}>
                            {i > 0 && ", "}
                            <span className="rounded bg-purple-100 px-1.5 py-0.5 text-xs text-purple-700">
                              {getArtistName(a.artist)}
                            </span>
                          </span>
                        ))}
                      </span>
                    )}
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
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => idx > 0 && handleSwap(item, items[idx - 1])}
                    disabled={idx === 0 || reorderLoading}
                    className="rounded px-1.5 py-0.5 text-sm text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-30 disabled:hover:bg-transparent"
                    title="위로 이동"
                    aria-label="Move item up"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    onClick={() => idx < items.length - 1 && handleSwap(item, items[idx + 1])}
                    disabled={idx === items.length - 1 || reorderLoading}
                    className="rounded px-1.5 py-0.5 text-sm text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-30 disabled:hover:bg-transparent"
                    title="아래로 이동"
                    aria-label="Move item down"
                  >
                    ▼
                  </button>
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
              </div>
              {/* Insert after button */}
              <div className="flex justify-center py-0.5">
                <button
                  type="button"
                  onClick={() => handleInsertAfter(item.position)}
                  disabled={reorderLoading}
                  className="text-xs text-zinc-300 hover:text-blue-500 disabled:opacity-30"
                  title={`${item.position}번 다음에 삽입`}
                >
                  + 여기에 삽입
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

          {/* Artist selector */}
          <div ref={artistSearchRef}>
            <label className="mb-1 block text-xs font-medium">
              아티스트 (유닛/솔로)
            </label>
            {selectedArtists.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {selectedArtists.map((artist) => (
                  <span
                    key={artist.id}
                    className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2.5 py-1 text-xs font-medium text-purple-800"
                  >
                    {getArtistName(artist)}
                    <button
                      type="button"
                      onClick={() => removeArtist(artist.id)}
                      className="ml-0.5 text-purple-500 hover:text-purple-700"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="relative">
              <input
                type="text"
                value={artistSearch}
                onChange={(e) => handleArtistSearchChange(e.target.value)}
                onFocus={() => { if (artistSearch.trim()) setArtistDropdownOpen(true); }}
                placeholder="아티스트 검색..."
                className="w-full rounded border border-zinc-300 px-3 py-1.5 text-sm"
              />
              {artistSearchLoading && (
                <span className="absolute right-2 top-1.5 text-xs text-zinc-400">검색 중...</span>
              )}
              {artistDropdownOpen && artistSearch.trim() && (
                <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded border border-zinc-200 bg-white shadow-lg">
                  {artistSearchResults.map((artist) => {
                    const isSelected = formArtistIds.includes(artist.id);
                    return (
                      <button
                        key={artist.id}
                        type="button"
                        onClick={() => selectArtist(artist)}
                        className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-purple-50 ${isSelected ? "bg-zinc-50 text-zinc-400" : ""}`}
                      >
                        {isSelected && <span className="mr-1">✓</span>}
                        {getArtistName(artist)}
                      </button>
                    );
                  })}
                  {!artistSearchLoading && artistSearchResults.length === 0 && (
                    <div className="px-3 py-2 text-xs text-zinc-400">일치하는 아티스트가 없습니다</div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Song selector — only for song type */}
          {formType === "song" && <div>
            <label className="mb-1 block text-xs font-medium">
              곡 (복수 선택 = 메들리)
            </label>
            {/* Selected song tags */}
            {selectedSongs.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {selectedSongs.map((song) => (
                  <span
                    key={song.id}
                    className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-1 text-xs font-medium text-blue-800"
                  >
                    {getSongName(song)}
                    <button
                      type="button"
                      onClick={() => removeSong(song.id)}
                      className="ml-0.5 text-blue-500 hover:text-blue-700"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            {/* Shared search component. includeVariants=true preserves
                the admin's pre-refactor ability to record a variant row
                (e.g. "Dream Believers (SAKURA Ver.)") directly. Fan
                pickers omit the prop and get base-only. */}
            <SongSearch
              onSelect={selectSong}
              locale="ko"
              texts={{
                placeholder: "곡 검색...",
                loading: "검색 중...",
                noResults: "일치하는 곡이 없습니다",
              }}
              excludeSongIds={formSongIds}
              includeVariants
            />
            <a
              href="/admin/songs/new"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-block text-xs text-blue-600 hover:underline"
            >
              + 새 곡 추가
            </a>
          </div>}

          {/* Performer selector */}
          <div ref={performerSearchRef}>
            <label className="mb-1 block text-xs font-medium">출연진</label>
            {/* Selected performer tags */}
            {selectedPerformers.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {selectedPerformers.map((si) => (
                  <span
                    key={si.id}
                    className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-800"
                  >
                    {getSIName(si)}
                    <button
                      type="button"
                      onClick={() => removePerformer(si.id)}
                      className="ml-0.5 text-green-500 hover:text-green-700"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            {/* Search input */}
            <div className="relative">
              <input
                type="text"
                value={performerSearch}
                onChange={(e) => { setPerformerSearch(e.target.value); setPerformerDropdownOpen(true); }}
                onFocus={() => setPerformerDropdownOpen(true)}
                placeholder="출연진 검색..."
                className="w-full rounded border border-zinc-300 px-3 py-1.5 text-sm"
              />
              {/* Dropdown */}
              {performerDropdownOpen && (
                <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded border border-zinc-200 bg-white shadow-lg">
                  {getFilteredPerformers().map((si) => {
                    const isSelected = formPerformerIds.includes(si.id);
                    const artistName = si.artistLinks[0]
                      ? (si.artistLinks[0].artist.translations.find(
                          (t) => t.locale === "ko"
                        )?.name ?? "")
                      : "";
                    return (
                      <button
                        key={si.id}
                        type="button"
                        onClick={() => selectPerformer(si)}
                        className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-green-50 ${isSelected ? "bg-zinc-50 text-zinc-400" : ""}`}
                      >
                        {isSelected && <span className="mr-1">✓</span>}
                        {getSIName(si)}
                        {artistName && (
                          <span className="ml-1 text-xs text-zinc-400">({artistName})</span>
                        )}
                      </button>
                    );
                  })}
                  {getFilteredPerformers().length === 0 && (
                    <div className="px-3 py-2 text-xs text-zinc-400">일치하는 출연진이 없습니다</div>
                  )}
                </div>
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
