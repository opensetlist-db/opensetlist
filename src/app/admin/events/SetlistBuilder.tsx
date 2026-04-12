"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { matchesIdentitySearch } from "@/lib/search";

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
      translations: { locale: string; title: string }[];
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
  return (
    song.translations.find((t) => t.locale === "ko")?.title ??
    song.originalTitle
  );
}

function getSIName(si: { translations: { locale: string; name: string }[] }) {
  return si.translations.find((t) => t.locale === "ko")?.name ?? "Unknown";
}

function getArtistName(a: { translations: { locale: string; name: string }[] }) {
  return a.translations.find((t) => t.locale === "ko")?.name ?? "Unknown";
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
  const [formArtistIds, setFormArtistIds] = useState<number[]>([]);

  // Search-based selectors
  const [songSearch, setSongSearch] = useState("");
  const [songSearchResults, setSongSearchResults] = useState<SongOption[]>([]);
  const [songSearchLoading, setSongSearchLoading] = useState(false);
  const [songDropdownOpen, setSongDropdownOpen] = useState(false);
  const [selectedSongs, setSelectedSongs] = useState<SongOption[]>([]);
  const songSearchRef = useRef<HTMLDivElement>(null);
  const songSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Click-outside handlers for dropdowns
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (songSearchRef.current && !songSearchRef.current.contains(e.target as Node)) {
        setSongDropdownOpen(false);
      }
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

  const searchSongs = useCallback((query: string) => {
    if (songSearchTimerRef.current) clearTimeout(songSearchTimerRef.current);
    if (!query.trim()) {
      setSongSearchResults([]);
      setSongSearchLoading(false);
      return;
    }
    setSongSearchLoading(true);
    songSearchTimerRef.current = setTimeout(async () => {
      const res = await fetch(`/api/admin/songs?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      setSongSearchResults(data);
      setSongSearchLoading(false);
    }, 300);
  }, []);

  function handleSongSearchChange(value: string) {
    setSongSearch(value);
    setSongDropdownOpen(true);
    searchSongs(value);
  }

  function selectSong(song: SongOption) {
    if (!formSongIds.includes(song.id)) {
      setFormSongIds((prev) => [...prev, song.id]);
      setSelectedSongs((prev) => [...prev, song]);
    }
    setSongSearch("");
    setSongSearchResults([]);
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
    setSongSearch("");
    setSongSearchResults([]);
    setSelectedSongs([]);
    setPerformerSearch("");
    setSelectedPerformers([]);
    setFormArtistIds([]);
    setArtistSearch("");
    setArtistSearchResults([]);
    setSelectedArtists([]);
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
      // Reload items
      const eventRes = await fetch(`/api/admin/events/${eventId}`);
      const eventData = await eventRes.json();
      setItems(eventData.setlistItems);
    } else {
      const errData = await res.json().catch(() => null);
      alert(errData?.error || "저장에 실패했습니다.");
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
          {formType === "song" && <div ref={songSearchRef}>
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
            {/* Search input */}
            <div className="relative">
              <input
                type="text"
                value={songSearch}
                onChange={(e) => handleSongSearchChange(e.target.value)}
                onFocus={() => { if (songSearch.trim()) setSongDropdownOpen(true); }}
                placeholder="곡 검색..."
                className="w-full rounded border border-zinc-300 px-3 py-1.5 text-sm"
              />
              {songSearchLoading && (
                <span className="absolute right-2 top-1.5 text-xs text-zinc-400">검색 중...</span>
              )}
              {/* Dropdown */}
              {songDropdownOpen && songSearch.trim() && (
                <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded border border-zinc-200 bg-white shadow-lg">
                  {songSearchResults.map((song) => {
                    const isSelected = formSongIds.includes(song.id);
                    return (
                      <button
                        key={song.id}
                        type="button"
                        onClick={() => selectSong(song)}
                        className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-blue-50 ${isSelected ? "bg-zinc-50 text-zinc-400" : ""}`}
                      >
                        {isSelected && <span className="mr-1">✓</span>}
                        {getSongName(song)}
                      </button>
                    );
                  })}
                  {!songSearchLoading && songSearchResults.length === 0 && (
                    <div className="px-3 py-2 text-xs text-zinc-400">일치하는 곡이 없습니다</div>
                  )}
                  {songSearch.trim() && !songSearchLoading && (
                    <a
                      href="/admin/songs/new"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block border-t border-zinc-100 px-3 py-2 text-xs text-blue-600 hover:bg-blue-50"
                    >
                      + &quot;{songSearch}&quot; 새 곡 추가
                    </a>
                  )}
                </div>
              )}
            </div>
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
