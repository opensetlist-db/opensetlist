"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

type Translation = { locale: string; name: string; bio: string };
type StageIdentityInput = {
  type: "character" | "persona";
  color: string;
  translations: { locale: string; name: string }[];
  realPerson?: {
    translations: { locale: string; name: string; stageName: string }[];
  };
};

type ExistingStageIdentity = {
  id: string;
  type: string;
  color: string | null;
  name: string;
  vaName: string | null;
};

type ArtistFormProps = {
  initialData?: {
    id: number;
    type: string;
    parentArtistId: number | null;
    hasBoard: boolean;
    translations: Translation[];
    groupIds: string[];
    existingStageIdentities?: ExistingStageIdentity[];
  };
};

const ARTIST_TYPES = ["solo", "group", "unit", "band"];
const LOCALES = ["ko", "ja", "en", "zh-CN"];

export default function ArtistForm({ initialData }: ArtistFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [type, setType] = useState(initialData?.type ?? "group");
  const [parentArtistId, setParentArtistId] = useState(
    initialData?.parentArtistId?.toString() ?? ""
  );
  const [hasBoard, setHasBoard] = useState(initialData?.hasBoard ?? true);
  const [translations, setTranslations] = useState<Translation[]>(
    initialData?.translations.length
      ? initialData.translations
      : [{ locale: "ko", name: "", bio: "" }]
  );
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>(
    initialData?.groupIds ?? []
  );
  const [stageIdentities, setStageIdentities] = useState<StageIdentityInput[]>(
    []
  );

  // Available groups and artists for selectors
  const [groups, setGroups] = useState<
    { id: string; translations: { locale: string; name: string }[] }[]
  >([]);
  const [artists, setArtists] = useState<
    { id: number; translations: { locale: string; name: string }[] }[]
  >([]);

  useEffect(() => {
    fetch("/api/admin/groups")
      .then((r) => r.json())
      .then(setGroups);
    fetch("/api/admin/artists")
      .then((r) => r.json())
      .then(setArtists);
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
      setTranslations((prev) => [...prev, { locale: next, name: "", bio: "" }]);
    }
  }

  function removeTranslation(index: number) {
    if (translations.length > 1) {
      setTranslations((prev) => prev.filter((_, i) => i !== index));
    }
  }

  function addStageIdentity() {
    setStageIdentities((prev) => [
      ...prev,
      {
        type: "character",
        color: "",
        translations: [{ locale: "ko", name: "" }],
        realPerson: {
          translations: [{ locale: "ko", name: "", stageName: "" }],
        },
      },
    ]);
  }

  function removeStageIdentity(index: number) {
    setStageIdentities((prev) => prev.filter((_, i) => i !== index));
  }

  function updateSI(
    index: number,
    field: "type" | "color",
    value: string
  ) {
    setStageIdentities((prev) =>
      prev.map((si, i) => (i === index ? { ...si, [field]: value } : si))
    );
  }

  function updateSITranslation(
    siIndex: number,
    field: "name",
    value: string
  ) {
    setStageIdentities((prev) =>
      prev.map((si, i) =>
        i === siIndex
          ? {
              ...si,
              translations: si.translations.map((t, j) =>
                j === 0 ? { ...t, [field]: value } : t
              ),
            }
          : si
      )
    );
  }

  function updateRPTranslation(
    siIndex: number,
    field: "name" | "stageName",
    value: string
  ) {
    setStageIdentities((prev) =>
      prev.map((si, i) =>
        i === siIndex && si.realPerson
          ? {
              ...si,
              realPerson: {
                translations: si.realPerson.translations.map((t, j) =>
                  j === 0 ? { ...t, [field]: value } : t
                ),
              },
            }
          : si
      )
    );
  }

  async function handleAddStageIdentityToExisting() {
    addStageIdentity();
  }

  async function saveNewStageIdentities() {
    if (!initialData || stageIdentities.length === 0) return true;

    for (const si of stageIdentities) {
      if (!si.translations[0]?.name.trim()) continue;
      const res = await fetch(
        `/api/admin/artists/${initialData.id}/stage-identities`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(si),
        }
      );
      if (!res.ok) return false;
    }
    return true;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const payload = {
      type,
      parentArtistId: parentArtistId || null,
      hasBoard,
      translations: translations.filter((t) => t.name.trim()),
      groupIds: selectedGroupIds,
      stageIdentities: stageIdentities.length ? stageIdentities : undefined,
    };

    const url = initialData
      ? `/api/admin/artists/${initialData.id}`
      : "/api/admin/artists";
    const method = initialData ? "PUT" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      // Save new stage identities for existing artist
      if (initialData && stageIdentities.length > 0) {
        const siOk = await saveNewStageIdentities();
        if (!siOk) {
          alert("멤버 추가에 실패했습니다.");
          setLoading(false);
          return;
        }
      }
      router.push("/admin/artists");
      router.refresh();
    } else {
      alert("저장에 실패했습니다.");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
      {/* Type */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium">타입</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="w-full rounded border border-zinc-300 px-3 py-2"
          >
            {ARTIST_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">
            상위 아티스트
          </label>
          <select
            value={parentArtistId}
            onChange={(e) => setParentArtistId(e.target.value)}
            className="w-full rounded border border-zinc-300 px-3 py-2"
          >
            <option value="">없음</option>
            {artists
              .filter((a) => a.id !== initialData?.id)
              .map((a) => {
                const name =
                  a.translations.find((t) => t.locale === "ko")?.name ??
                  a.translations[0]?.name ??
                  `ID: ${a.id}`;
                return (
                  <option key={a.id} value={a.id}>
                    {name}
                  </option>
                );
              })}
          </select>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={hasBoard}
          onChange={(e) => setHasBoard(e.target.checked)}
        />
        게시판 활성화
      </label>

      {/* Groups */}
      {groups.length > 0 && (
        <div>
          <label className="mb-1 block text-sm font-medium">소속 그룹</label>
          <div className="flex flex-wrap gap-2">
            {groups.map((g) => {
              const name =
                g.translations.find((t) => t.locale === "ko")?.name ??
                g.translations[0]?.name ??
                g.id;
              const selected = selectedGroupIds.includes(g.id);
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() =>
                    setSelectedGroupIds((prev) =>
                      selected
                        ? prev.filter((id) => id !== g.id)
                        : [...prev, g.id]
                    )
                  }
                  className={`rounded-full px-3 py-1 text-sm ${
                    selected
                      ? "bg-blue-600 text-white"
                      : "bg-zinc-100 text-zinc-700"
                  }`}
                >
                  {name}
                </button>
              );
            })}
          </div>
        </div>
      )}

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
              className="rounded border border-zinc-200 bg-white p-3"
            >
              <div className="mb-2 flex items-center justify-between">
                <select
                  value={tr.locale}
                  onChange={(e) => updateTranslation(i, "locale", e.target.value)}
                  className="rounded border border-zinc-300 px-2 py-1 text-sm"
                >
                  {LOCALES.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
                {translations.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeTranslation(i)}
                    className="text-sm text-red-500 hover:underline"
                  >
                    삭제
                  </button>
                )}
              </div>
              <input
                placeholder="이름"
                value={tr.name}
                onChange={(e) => updateTranslation(i, "name", e.target.value)}
                className="mb-2 w-full rounded border border-zinc-300 px-3 py-2 text-sm"
              />
              <textarea
                placeholder="소개 (선택)"
                value={tr.bio}
                onChange={(e) => updateTranslation(i, "bio", e.target.value)}
                rows={2}
                className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Stage Identities */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="text-sm font-medium">
            멤버 / 스테이지 아이덴티티
          </label>
          <button
            type="button"
            onClick={initialData ? handleAddStageIdentityToExisting : addStageIdentity}
            className="text-sm text-blue-600 hover:underline"
          >
            + 멤버 추가
          </button>
        </div>

        {/* Existing stage identities (edit mode) */}
        {initialData?.existingStageIdentities && initialData.existingStageIdentities.length > 0 && (
          <div className="mb-3 space-y-2">
            {initialData.existingStageIdentities.map((si) => (
              <div
                key={si.id}
                className="flex items-center gap-2 rounded border border-zinc-200 bg-zinc-50 p-3"
              >
                {si.color && (
                  <span
                    className="inline-block h-3 w-3 rounded-full"
                    style={{ backgroundColor: si.color }}
                  />
                )}
                <span className="font-medium">{si.name}</span>
                <span className="text-xs text-zinc-400">{si.type}</span>
                {si.vaName && (
                  <span className="text-sm text-zinc-500">
                    (CV: {si.vaName})
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* New stage identities form */}
        <div className="space-y-3">
          {stageIdentities.map((si, i) => (
            <div
              key={i}
              className="rounded border border-zinc-200 bg-white p-3"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium">새 멤버 {i + 1}</span>
                <button
                  type="button"
                  onClick={() => removeStageIdentity(i)}
                  className="text-sm text-red-500 hover:underline"
                >
                  삭제
                </button>
              </div>
              <div className="mb-2 grid grid-cols-2 gap-2">
                <select
                  value={si.type}
                  onChange={(e) => updateSI(i, "type", e.target.value)}
                  className="rounded border border-zinc-300 px-2 py-1 text-sm"
                >
                  <option value="character">캐릭터</option>
                  <option value="persona">페르소나</option>
                </select>
                <input
                  placeholder="컬러 (#FF69B4)"
                  value={si.color}
                  onChange={(e) => updateSI(i, "color", e.target.value)}
                  className="rounded border border-zinc-300 px-2 py-1 text-sm"
                />
              </div>
              <input
                placeholder="캐릭터/페르소나 이름"
                value={si.translations[0]?.name ?? ""}
                onChange={(e) => updateSITranslation(i, "name", e.target.value)}
                className="mb-2 w-full rounded border border-zinc-300 px-3 py-2 text-sm"
              />
              <input
                placeholder="성우/본명"
                value={si.realPerson?.translations[0]?.name ?? ""}
                onChange={(e) => updateRPTranslation(i, "name", e.target.value)}
                className="mb-2 w-full rounded border border-zinc-300 px-3 py-2 text-sm"
              />
              <input
                placeholder="예명 (선택)"
                value={si.realPerson?.translations[0]?.stageName ?? ""}
                onChange={(e) =>
                  updateRPTranslation(i, "stageName", e.target.value)
                }
                className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
              />
            </div>
          ))}
        </div>
      </div>

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
