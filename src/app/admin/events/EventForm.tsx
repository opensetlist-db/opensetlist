"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { matchesIdentitySearch } from "@/lib/search";
import { ADMIN_UNKNOWN_NAME } from "@/lib/admin-constants";
import { formatDate } from "@/lib/utils";

// Korean labels for the BD Album picker's type tag. Admin surface is
// Korean-only per CLAUDE.md, so we don't route through next-intl here
// — the picker is a single short list and threading i18n keys would
// add overhead without payoff. `AlbumType` enum is closed at the
// schema level (single | album | ep | live_album | soundtrack — see
// prisma/schema.prisma:137) so a missing entry is a deploy-time
// failure caught by lint, not a runtime risk. `Record<string,string>`
// + fallback keeps a future enum extension from crashing the picker.
const ALBUM_TYPE_LABEL_KO: Record<string, string> = {
  single: "싱글",
  album: "앨범",
  ep: "EP",
  live_album: "라이브 BD",
  soundtrack: "OST",
};

type Translation = {
  locale: string;
  name: string;
  shortName: string;
  city: string;
  venue: string;
};

type StageIdentityOption = {
  id: string;
  translations: { locale: string; name: string }[];
  artistLinks: {
    artist: { translations: { locale: string; name: string }[] };
  }[];
};

type InitialPerformer = {
  isGuest: boolean;
  stageIdentity: StageIdentityOption;
};

type EventFormProps = {
  initialData?: {
    id: number;
    type: string;
    status: string;
    eventSeriesId: number | null;
    artistId: number | null;
    bdAlbumId: number | null;
    organizerName: string | null;
    date: string | null;
    country: string | null;
    posterUrl: string | null;
    startTime: string;
    originalName: string;
    originalShortName: string;
    originalCity: string;
    originalVenue: string;
    originalLanguage: string;
    translations: Translation[];
    performers: InitialPerformer[];
  };
};

type AlbumOption = {
  id: number;
  slug: string;
  type: string;
  releaseDate: string | null;
  originalTitle: string;
  translations: { locale: string; title: string }[];
};

type ArtistOption = {
  id: number;
  translations: { locale: string; name: string }[];
  parentArtist: {
    translations: { locale: string; name: string }[];
  } | null;
};

const EVENT_TYPES = ["concert", "festival", "fan_meeting", "showcase", "virtual_live"];
const EVENT_STATUSES = ["scheduled", "ongoing", "completed", "cancelled"];
const LOCALES = ["ko", "ja", "en", "zh-CN"];
const ORIGINAL_LANGUAGES = ["ja", "ko", "en", "zh-CN"];

function emptyTranslation(locale: string): Translation {
  return { locale, name: "", shortName: "", city: "", venue: "" };
}

function getSIName(si: StageIdentityOption) {
  return si.translations.find((t) => t.locale === "ko")?.name ?? ADMIN_UNKNOWN_NAME;
}

export default function EventForm({ initialData }: EventFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [type, setType] = useState(initialData?.type ?? "concert");
  const [status, setStatus] = useState(initialData?.status ?? "scheduled");
  const [eventSeriesId, setEventSeriesId] = useState(
    initialData?.eventSeriesId?.toString() ?? ""
  );
  // artistId / organizerName mirror the EventSeries.artistId /
  // EventSeries.organizerName pattern at the Event level — see the
  // schema comment on Event. The events list page groups series-less
  // events by these fields, so an unset standalone event will land
  // in the catchall "기타 이벤트" bucket until the operator picks
  // one (or the post-deploy.sql safety net infers artistId from the
  // performer roster).
  const [artistId, setArtistId] = useState(
    initialData?.artistId?.toString() ?? ""
  );
  // BD 앨범 — 이 라이브의 Blu-ray 발매가 결정되면 운영자가 Album row를
  // 만들고 (CSV import 또는 /admin/albums/[id]/edit) 해당 id를 여기서
  // 선택한다. 멀티-이벤트 BD(예: 6th 도쿄 Day1+Day2 → Memorial BOX)도
  // 같은 Album id를 양쪽 이벤트에 지정하면 양쪽 페이지가 같은
  // EventBdSection을 노출한다.
  const [bdAlbumId, setBdAlbumId] = useState(
    initialData?.bdAlbumId?.toString() ?? ""
  );
  const [organizerName, setOrganizerName] = useState(
    initialData?.organizerName ?? ""
  );
  const [date, setDate] = useState(initialData?.date ?? "");
  const [country, setCountry] = useState(initialData?.country ?? "");
  const [posterUrl, setPosterUrl] = useState(initialData?.posterUrl ?? "");
  const [startTime, setStartTime] = useState(initialData?.startTime ?? "");
  const [originalLanguage, setOriginalLanguage] = useState(
    initialData?.originalLanguage ?? "ja"
  );
  const [originalName, setOriginalName] = useState(initialData?.originalName ?? "");
  const [originalShortName, setOriginalShortName] = useState(
    initialData?.originalShortName ?? ""
  );
  const [originalCity, setOriginalCity] = useState(initialData?.originalCity ?? "");
  const [originalVenue, setOriginalVenue] = useState(initialData?.originalVenue ?? "");
  const [translations, setTranslations] = useState<Translation[]>(
    initialData?.translations.length
      ? initialData.translations
      : [emptyTranslation("ko")]
  );

  const [seriesList, setSeriesList] = useState<
    { id: number; translations: { locale: string; name: string }[] }[]
  >([]);

  const [artistList, setArtistList] = useState<ArtistOption[]>([]);

  const [albumList, setAlbumList] = useState<AlbumOption[]>([]);

  const [stageIdentities, setStageIdentities] = useState<StageIdentityOption[]>([]);

  const initialPerformers = (initialData?.performers ?? [])
    .filter((p) => !p.isGuest)
    .map((p) => p.stageIdentity);
  const initialGuests = (initialData?.performers ?? [])
    .filter((p) => p.isGuest)
    .map((p) => p.stageIdentity);

  const [selectedPerformers, setSelectedPerformers] =
    useState<StageIdentityOption[]>(initialPerformers);
  const [selectedGuests, setSelectedGuests] =
    useState<StageIdentityOption[]>(initialGuests);

  const [performerSearch, setPerformerSearch] = useState("");
  const [performerDropdownOpen, setPerformerDropdownOpen] = useState(false);
  const performerRef = useRef<HTMLDivElement>(null);

  const [guestSearch, setGuestSearch] = useState("");
  const [guestDropdownOpen, setGuestDropdownOpen] = useState(false);
  const guestRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/admin/event-series")
      .then((r) => r.json())
      .then(setSeriesList);
    fetch("/api/admin/artists")
      .then((r) => r.json())
      .then(setArtistList);
    fetch("/api/admin/albums")
      .then((r) => r.json())
      // The endpoint returns a JSON `{ error }` (not an array) on a DB
      // error, so guard before setState — otherwise `albumList.map(...)`
      // in the BD-album picker throws and crashes the whole form. Keep
      // the prior `[]` on failure so the form still renders (sans picker).
      .then((data) => {
        if (Array.isArray(data)) setAlbumList(data);
      })
      .catch(() => {});
    fetch("/api/admin/stage-identities")
      .then((r) => r.json())
      .then(setStageIdentities);
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (performerRef.current && !performerRef.current.contains(e.target as Node)) {
        setPerformerDropdownOpen(false);
      }
      if (guestRef.current && !guestRef.current.contains(e.target as Node)) {
        setGuestDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function updateTranslation(
    index: number,
    field: keyof Translation,
    value: string
  ) {
    setTranslations((prev) =>
      prev.map((t, i) => (i === index ? { ...t, [field]: value } : t))
    );
  }

  function addTranslation() {
    const usedLocales = translations.map((t) => t.locale);
    const next = LOCALES.find((l) => !usedLocales.includes(l));
    if (next) {
      setTranslations((prev) => [...prev, emptyTranslation(next)]);
    }
  }

  function filteredFor(search: string) {
    if (!search.trim()) return stageIdentities;
    return stageIdentities.filter((si) => matchesIdentitySearch(si, search));
  }

  // Adding to one picker removes from the other — EventPerformer has
  // @@unique([eventId, stageIdentityId]), so the same identity can't be
  // both a performer and a guest on the same event.
  function selectPerformer(si: StageIdentityOption) {
    setSelectedGuests((prev) => prev.filter((g) => g.id !== si.id));
    setSelectedPerformers((prev) =>
      prev.some((p) => p.id === si.id) ? prev : [...prev, si]
    );
    setPerformerSearch("");
  }
  function removePerformer(id: string) {
    setSelectedPerformers((prev) => prev.filter((p) => p.id !== id));
  }
  function selectGuest(si: StageIdentityOption) {
    setSelectedPerformers((prev) => prev.filter((p) => p.id !== si.id));
    setSelectedGuests((prev) =>
      prev.some((p) => p.id === si.id) ? prev : [...prev, si]
    );
    setGuestSearch("");
  }
  function removeGuest(id: string) {
    setSelectedGuests((prev) => prev.filter((p) => p.id !== id));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!startTime) {
      alert("시작 시각은 필수입니다.");
      return;
    }

    if (!originalName.trim()) {
      alert("원본 이름(originalName)은 필수입니다.");
      return;
    }

    setLoading(true);

    const payload = {
      type,
      status,
      eventSeriesId: eventSeriesId || null,
      artistId: artistId || null,
      bdAlbumId: bdAlbumId || null,
      organizerName: organizerName.trim() || null,
      date: date || null,
      country: country || null,
      posterUrl: posterUrl || null,
      startTime: `${startTime}Z`,
      originalName: originalName.trim(),
      originalShortName: originalShortName.trim() || null,
      originalCity: originalCity.trim() || null,
      originalVenue: originalVenue.trim() || null,
      originalLanguage,
      translations: translations
        .filter((t) => t.name.trim())
        .map((t) => ({
          locale: t.locale,
          name: t.name,
          shortName: t.shortName || null,
          city: t.city || null,
          venue: t.venue || null,
        })),
      performerIds: selectedPerformers.map((p) => p.id),
      guestIds: selectedGuests.map((g) => g.id),
    };

    const url = initialData
      ? `/api/admin/events/${initialData.id}`
      : "/api/admin/events";
    const method = initialData ? "PUT" : "POST";

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        router.push("/admin/events");
        router.refresh();
        return;
      }

      // Surface the API's `error` field (e.g. slug 409 / validation
      // 400) so the operator sees the actual reason instead of digging
      // through Sentry.
      const body = await res.json().catch(() => null);
      alert(body?.error ?? "저장에 실패했습니다.");
    } catch {
      alert("저장에 실패했습니다. 네트워크를 확인해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  function renderPicker(opts: {
    label: string;
    selected: StageIdentityOption[];
    search: string;
    setSearch: (v: string) => void;
    open: boolean;
    setOpen: (v: boolean) => void;
    containerRef: React.RefObject<HTMLDivElement | null>;
    onSelect: (si: StageIdentityOption) => void;
    onRemove: (id: string) => void;
    placeholder: string;
    tagClassName: string;
    tagRemoveClassName: string;
    hoverClassName: string;
  }) {
    return (
      <div ref={opts.containerRef}>
        <label className="mb-1 block text-sm font-medium">{opts.label}</label>
        {opts.selected.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {opts.selected.map((si) => (
              <span
                key={si.id}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${opts.tagClassName}`}
              >
                {getSIName(si)}
                <button
                  type="button"
                  onClick={() => opts.onRemove(si.id)}
                  className={`ml-0.5 ${opts.tagRemoveClassName}`}
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
            value={opts.search}
            onChange={(e) => {
              opts.setSearch(e.target.value);
              opts.setOpen(true);
            }}
            onFocus={() => opts.setOpen(true)}
            placeholder={opts.placeholder}
            className="w-full rounded border border-zinc-300 px-3 py-1.5 text-sm"
          />
          {opts.open && (
            <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded border border-zinc-200 bg-white shadow-lg">
              {filteredFor(opts.search).map((si) => {
                const isSelected = opts.selected.some((p) => p.id === si.id);
                const artistName = si.artistLinks[0]
                  ? (si.artistLinks[0].artist.translations.find(
                      (t) => t.locale === "ko"
                    )?.name ?? "")
                  : "";
                return (
                  <button
                    key={si.id}
                    type="button"
                    onClick={() => opts.onSelect(si)}
                    className={`block w-full px-3 py-1.5 text-left text-sm ${opts.hoverClassName} ${isSelected ? "bg-zinc-50 text-zinc-400" : ""}`}
                  >
                    {isSelected && <span className="mr-1">✓</span>}
                    {getSIName(si)}
                    {artistName && (
                      <span className="ml-1 text-xs text-zinc-400">({artistName})</span>
                    )}
                  </button>
                );
              })}
              {filteredFor(opts.search).length === 0 && (
                <div className="px-3 py-2 text-xs text-zinc-400">일치하는 항목이 없습니다</div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-xl space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium">타입</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="w-full rounded border border-zinc-300 px-3 py-2"
          >
            {EVENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">상태</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-full rounded border border-zinc-300 px-3 py-2"
          >
            {EVENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">시리즈</label>
        <select
          value={eventSeriesId}
          onChange={(e) => setEventSeriesId(e.target.value)}
          className="w-full rounded border border-zinc-300 px-3 py-2"
        >
          <option value="">없음</option>
          {seriesList.map((s) => {
            const name =
              s.translations.find((t) => t.locale === "ko")?.name ??
              s.translations[0]?.name ??
              `ID: ${s.id}`;
            return (
              <option key={s.id} value={s.id}>
                {name}
              </option>
            );
          })}
        </select>
      </div>

      {/*
        아티스트 / 주최자 — 시리즈가 없는 단독 공연을 이벤트 목록 페이지에서
        아티스트별로 묶기 위해 사용한다. 우선순위: 시리즈 > 아티스트 >
        organizerName > 기타. 시리즈를 선택했다면 보통 비워둬도 무방하다
        (시리즈의 artistId가 그룹 헤더의 아티스트 뱃지를 결정).

        멀티-아티스트 단독 공연은 아티스트를 비워두고 organizerName에
        주최자명을 적는다 (예: "Bandai Namco / Lantis").

        operator가 비워둬도 post-deploy.sql 백필이 EventPerformer
        rosters에서 유일한 top-level 아티스트가 결정되면 자동으로 채워준다.
      */}
      <div className="rounded border border-zinc-300 bg-zinc-50 p-4">
        <div className="mb-3 text-sm font-medium">
          아티스트 / 주최자 (시리즈 없는 단독 공연용)
        </div>
        <div className="mb-3">
          <label className="mb-1 block text-xs text-zinc-600">아티스트</label>
          <select
            value={artistId}
            onChange={(e) => setArtistId(e.target.value)}
            className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
          >
            <option value="">없음 / 자동 결정</option>
            {artistList.map((a) => {
              const name =
                a.translations.find((t) => t.locale === "ko")?.name ??
                a.translations[0]?.name ??
                `ID: ${a.id}`;
              const parentName = a.parentArtist
                ? (a.parentArtist.translations.find((t) => t.locale === "ko")?.name ??
                  a.parentArtist.translations[0]?.name ??
                  null)
                : null;
              const label = parentName ? `${name} (${parentName})` : name;
              return (
                <option key={a.id} value={a.id}>
                  {label}
                </option>
              );
            })}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-zinc-600">
            주최자명 (멀티-아티스트 단독 공연용)
          </label>
          <input
            placeholder="예: Bandai Namco / Lantis"
            value={organizerName}
            onChange={(e) => setOrganizerName(e.target.value)}
            className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
          />
        </div>
      </div>

      {/*
        BD 앨범 — 이 라이브의 Blu-ray가 발표된 경우 해당 Album row를
        연결한다. 공개 페이지의 EventBdSection이 이 값을 읽어
        announce/preorder/released 상태를 자동 판정한다. 단독공연이거나
        BD 발매가 없는 라이브는 비워둔다 (대부분의 이벤트가 이쪽).
        멀티-이벤트 BD(Day1+Day2 → 같은 Memorial BOX)는 두 이벤트 모두
        동일 Album id를 선택.

        목록은 releaseDate desc 정렬 — 최근 발매 앨범부터 보여줘서
        운영자 멘탈 모델 ("방금 발표된 BD")과 일치시킨다.
      */}
      <div>
        <label className="mb-1 block text-sm font-medium">BD 앨범</label>
        <select
          value={bdAlbumId}
          onChange={(e) => setBdAlbumId(e.target.value)}
          className="w-full rounded border border-zinc-300 px-3 py-2"
        >
          <option value="">없음 (BD 미발표 / 발매 없음)</option>
          {albumList.map((a) => {
            const koTitle = a.translations.find((t) => t.locale === "ko")?.title;
            const title = koTitle ?? a.originalTitle ?? `ID: ${a.id}`;
            // Admin Korean-only surface (CLAUDE.md exemption) — but
            // formatDate(date, "ko") is still the canonical UTC→display
            // pathway for any operator-visible date. Hardcoding the
            // locale here is intentional since the picker only ever
            // renders to the operator and the picker label is
            // operator-only text.
            const releaseTag = a.releaseDate
              ? ` · ${formatDate(a.releaseDate, "ko")}`
              : "";
            const typeLabel = ALBUM_TYPE_LABEL_KO[a.type] ?? a.type;
            return (
              <option key={a.id} value={a.id}>
                [{typeLabel}] {title}{releaseTag}
              </option>
            );
          })}
        </select>
        <p className="mt-1 text-xs text-zinc-500">
          이 라이브의 Blu-ray Album row. 동일 BD가 여러 Event(예: Day1/Day2)에 걸치면 같은 Album을 선택.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium">날짜</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded border border-zinc-300 px-3 py-2"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">시작 시각 (UTC) *</label>
          <input
            type="datetime-local"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            required
            className="w-full rounded border border-zinc-300 px-3 py-2"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">국가 코드</label>
          <input
            placeholder="JP"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="w-32 rounded border border-zinc-300 px-3 py-2"
            maxLength={2}
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">포스터 URL (선택)</label>
        <input
          placeholder="https://..."
          value={posterUrl}
          onChange={(e) => setPosterUrl(e.target.value)}
          className="w-full rounded border border-zinc-300 px-3 py-2"
        />
      </div>

      <div className="rounded border border-zinc-300 bg-zinc-50 p-4">
        <div className="mb-3 text-sm font-medium">
          원본 (다른 언어 번역이 없을 때 표시)
        </div>
        <div className="mb-3">
          <label className="mb-1 block text-xs text-zinc-600">원본 언어</label>
          <select
            value={originalLanguage}
            onChange={(e) => setOriginalLanguage(e.target.value)}
            className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
          >
            {ORIGINAL_LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="mb-2 flex gap-2">
          <input
            placeholder="원본 이벤트명 (필수)"
            value={originalName}
            onChange={(e) => setOriginalName(e.target.value)}
            className="flex-1 rounded border border-zinc-300 px-3 py-2 text-sm"
            required
          />
          <input
            placeholder="원본 약칭 (선택)"
            value={originalShortName}
            onChange={(e) => setOriginalShortName(e.target.value)}
            className="w-28 rounded border border-zinc-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="flex gap-2">
          <input
            placeholder="원본 도시 (선택)"
            value={originalCity}
            onChange={(e) => setOriginalCity(e.target.value)}
            className="w-40 rounded border border-zinc-300 px-3 py-2 text-sm"
          />
          <input
            placeholder="원본 공연장 (선택)"
            value={originalVenue}
            onChange={(e) => setOriginalVenue(e.target.value)}
            className="flex-1 rounded border border-zinc-300 px-3 py-2 text-sm"
          />
        </div>
      </div>

      {/* Translations */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="text-sm font-medium">번역</label>
          {translations.length < LOCALES.length && (
            <button
              type="button"
              onClick={addTranslation}
              className="text-sm text-blue-600 hover:underline"
            >
              + 언어 추가
            </button>
          )}
        </div>
        <div className="space-y-3">
          {translations.map((tr, i) => (
            <div
              key={i}
              className="space-y-2 rounded border border-zinc-200 bg-white p-3"
            >
              <div className="flex items-center gap-2">
                <select
                  value={tr.locale}
                  onChange={(e) =>
                    updateTranslation(i, "locale", e.target.value)
                  }
                  className="rounded border border-zinc-300 px-2 py-1 text-sm"
                >
                  {LOCALES.map((l) => {
                    const usedByOther = translations.some(
                      (t, j) => j !== i && t.locale === l
                    );
                    return (
                      <option key={l} value={l} disabled={usedByOther}>
                        {l}
                      </option>
                    );
                  })}
                </select>
                <input
                  placeholder="이벤트명"
                  value={tr.name}
                  onChange={(e) => updateTranslation(i, "name", e.target.value)}
                  className="flex-1 rounded border border-zinc-300 px-3 py-2 text-sm"
                />
                <input
                  placeholder="약칭"
                  value={tr.shortName}
                  onChange={(e) => updateTranslation(i, "shortName", e.target.value)}
                  className="w-28 rounded border border-zinc-300 px-3 py-2 text-sm"
                />
                {translations.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      setTranslations((prev) =>
                        prev.filter((_, j) => j !== i)
                      )
                    }
                    className="text-sm text-red-500"
                  >
                    삭제
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  placeholder="도시 (예: 도쿄)"
                  value={tr.city}
                  onChange={(e) => updateTranslation(i, "city", e.target.value)}
                  className="w-40 rounded border border-zinc-300 px-3 py-2 text-sm"
                />
                <input
                  placeholder="공연장 (예: 도쿄돔)"
                  value={tr.venue}
                  onChange={(e) => updateTranslation(i, "venue", e.target.value)}
                  className="flex-1 rounded border border-zinc-300 px-3 py-2 text-sm"
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Performers */}
      {renderPicker({
        label: "공연자",
        selected: selectedPerformers,
        search: performerSearch,
        setSearch: setPerformerSearch,
        open: performerDropdownOpen,
        setOpen: setPerformerDropdownOpen,
        containerRef: performerRef,
        onSelect: selectPerformer,
        onRemove: removePerformer,
        placeholder: "공연자 검색...",
        tagClassName: "bg-green-100 text-green-800",
        tagRemoveClassName: "text-green-500 hover:text-green-700",
        hoverClassName: "hover:bg-green-50",
      })}

      {/* Guests */}
      {renderPicker({
        label: "게스트",
        selected: selectedGuests,
        search: guestSearch,
        setSearch: setGuestSearch,
        open: guestDropdownOpen,
        setOpen: setGuestDropdownOpen,
        containerRef: guestRef,
        onSelect: selectGuest,
        onRemove: removeGuest,
        placeholder: "게스트 검색...",
        tagClassName: "bg-amber-100 text-amber-800",
        tagRemoveClassName: "text-amber-500 hover:text-amber-700",
        hoverClassName: "hover:bg-amber-50",
      })}

      <button
        type="submit"
        disabled={loading}
        className="rounded bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? "저장 중..." : "저장"}
      </button>
    </form>
  );
}
