"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AlbumCoverEditor, { type CoverProvenance } from "./AlbumCoverEditor";
import { ADMIN_LOCALES, ADMIN_LANGUAGES } from "@/lib/adminLocales";
import { ALBUM_TYPES } from "@/lib/albumConstants";
import { UnlistedArtistOption } from "@/components/admin/artistPicker";

type Translation = { locale: string; title: string };

type AlbumFormProps = {
  initialData: {
    id: string;
    slug: string;
    type: string;
    originalTitle: string;
    originalLanguage: string;
    releaseDate: string | null;
    labelName: string | null;
    translations: Translation[];
    // String[] to keep Artist.id (BigInt server-side) safe through
    // JSON serialization. Earlier version used number[]; that path
    // silently truncated >2^53 ids. The PATCH route accepts string
    // ids via parseBigInt's string branch.
    artistIds: string[];
  };
  // The cover is edited and saved separately (AlbumCoverEditor); the
  // info save below never sends it, so it cannot overwrite a cover that
  // changed after this page loaded.
  cover: {
    imageUrl: string | null;
    provenance: CoverProvenance | null;
    r2PublicHost: string | null;
    uploadConfigured: boolean;
  };
};

type ArtistOption = {
  id: string;
  translations: { locale: string; name: string }[];
};

export default function AlbumForm({ initialData, cover }: AlbumFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const infoFormId = useId();

  // Unsaved (or unresolved) cover draft: warn before leaving the page,
  // for a reload/close (beforeunload) and for in-app links (a capture
  // listener, since the App Router has no navigation-blocking hook).
  const coverPendingRef = useRef(false);
  const onCoverDirtyChange = useCallback((pending: boolean) => {
    coverPendingRef.current = pending;
  }, []);
  useEffect(() => {
    const message =
      "저장하지 않았거나 결과를 확인하지 않은 표지 변경이 있습니다. 이 페이지를 떠날까요?";
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!coverPendingRef.current) return;
      e.preventDefault();
    }
    function onClick(e: MouseEvent) {
      if (!coverPendingRef.current || e.defaultPrevented || e.button !== 0)
        return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (!(a instanceof HTMLAnchorElement) || a.target === "_blank") return;
      if (a.origin !== window.location.origin) return;
      if (!window.confirm(message)) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, []);

  const [slug, setSlug] = useState(initialData.slug);
  const [type, setType] = useState(initialData.type);
  const [originalTitle, setOriginalTitle] = useState(initialData.originalTitle);
  const [originalLanguage, setOriginalLanguage] = useState(
    initialData.originalLanguage,
  );
  const [releaseDate, setReleaseDate] = useState(initialData.releaseDate ?? "");
  const [labelName, setLabelName] = useState(initialData.labelName ?? "");
  const [translations, setTranslations] = useState<Translation[]>(
    initialData.translations.length
      ? initialData.translations
      : [{ locale: "ko", title: "" }],
  );
  const [artistIds, setArtistIds] = useState<string[]>(initialData.artistIds);

  const [artistOptions, setArtistOptions] = useState<ArtistOption[]>([]);
  useEffect(() => {
    // Soft-fail on network error: the operator can still save the
    // album (artistIds preserves the existing links). Surfacing a hard
    // crash here would block the save button for an unrelated reason.
    // The /api/admin/artists endpoint serializes BigInt ids to JSON
    // numbers (via serializeBigInt in its route); normalize each one
    // to a string right at the receive boundary so the rest of the
    // form holds them in the same string shape as initialData.
    fetch("/api/admin/artists")
      .then((r) => (r.ok ? r.json() : []))
      .then(
        (
          data: {
            id: number | string;
            translations: ArtistOption["translations"];
          }[],
        ) => setArtistOptions(data.map((a) => ({ ...a, id: String(a.id) }))),
      )
      .catch(() => setArtistOptions([]));
  }, []);

  function updateTranslation(
    index: number,
    field: keyof Translation,
    value: string,
  ) {
    setTranslations((prev) =>
      prev.map((t, i) => (i === index ? { ...t, [field]: value } : t)),
    );
  }
  function addTranslation() {
    const used = translations.map((t) => t.locale);
    const next = ADMIN_LOCALES.find((l) => !used.includes(l));
    if (next) setTranslations((prev) => [...prev, { locale: next, title: "" }]);
  }

  function addArtistRow() {
    if (artistOptions.length === 0) return;
    const used = new Set(artistIds);
    const next = artistOptions.find((a) => !used.has(a.id));
    if (next) setArtistIds((prev) => [...prev, next.id]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const payload = {
      slug: slug.trim(),
      type,
      originalTitle: originalTitle.trim(),
      originalLanguage,
      releaseDate: releaseDate || null,
      labelName: labelName.trim() || null,
      // imageUrl deliberately absent: the server leaves the cover alone.
      translations: translations.filter((t) => t.title.trim()),
      artistIds,
    };

    try {
      const res = await fetch(`/api/admin/albums/${initialData.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        router.refresh();
        alert(
          coverPendingRef.current
            ? "앨범 정보를 저장했습니다. 표지 변경은 아직 저장 전입니다 — 표지 저장을 눌러 주세요."
            : "앨범 정보를 저장했습니다.",
        );
        return;
      }
      const body = await res.json().catch(() => null);
      alert(body?.error ?? "저장에 실패했습니다.");
    } catch {
      alert("저장에 실패했습니다. 네트워크를 확인해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <form id={infoFormId} onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-[1fr_auto] gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium">원제</label>
            <input
              value={originalTitle}
              onChange={(e) => setOriginalTitle(e.target.value)}
              className="w-full rounded border border-zinc-300 px-3 py-2"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">원어</label>
            <select
              value={originalLanguage}
              onChange={(e) => setOriginalLanguage(e.target.value)}
              className="rounded border border-zinc-300 px-3 py-2"
            >
              {ADMIN_LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium">슬러그</label>
            <div className="flex gap-2">
              <input
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                className="flex-1 rounded border border-zinc-300 px-3 py-2 font-mono text-sm"
                required
              />
              <a
                href="/admin/slug-generator"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded border border-zinc-300 px-2 py-2 text-xs text-zinc-600 hover:bg-zinc-50"
              >
                생성기
              </a>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">타입</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full rounded border border-zinc-300 px-3 py-2"
            >
              {ALBUM_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium">
              발매일 (선택)
            </label>
            <input
              type="date"
              value={releaseDate}
              onChange={(e) => setReleaseDate(e.target.value)}
              className="w-full rounded border border-zinc-300 px-3 py-2"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">
              레이블 (선택)
            </label>
            <input
              value={labelName}
              onChange={(e) => setLabelName(e.target.value)}
              placeholder="레이블 (예: 란티스 / BNML / 에이벡스)"
              className="w-full rounded border border-zinc-300 px-3 py-2"
            />
          </div>
        </div>
      </form>

      <AlbumCoverEditor
        albumId={initialData.id}
        albumTitle={initialData.originalTitle}
        initial={{ imageUrl: cover.imageUrl, provenance: cover.provenance }}
        r2PublicHost={cover.r2PublicHost}
        uploadConfigured={cover.uploadConfigured}
        onDirtyChange={onCoverDirtyChange}
      />

      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="text-sm font-medium">번역</label>
          {translations.length < ADMIN_LOCALES.length && (
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
              className="flex items-center gap-2 rounded border border-zinc-200 bg-white p-3"
            >
              <select
                value={tr.locale}
                onChange={(e) => updateTranslation(i, "locale", e.target.value)}
                className="rounded border border-zinc-300 px-2 py-1 text-sm"
              >
                {ADMIN_LOCALES.map((l) => {
                  // Disable locales already used by other rows so the
                  // operator can't produce two `ko` translations that
                  // the server's @@unique([albumId, locale]) would
                  // reject anyway. The current row's own value stays
                  // enabled so the select renders its selection.
                  const usedElsewhere =
                    l !== tr.locale &&
                    translations.some((t, j) => j !== i && t.locale === l);
                  return (
                    <option key={l} value={l} disabled={usedElsewhere}>
                      {l}
                    </option>
                  );
                })}
              </select>
              <input
                placeholder="제목"
                value={tr.title}
                onChange={(e) => updateTranslation(i, "title", e.target.value)}
                className="flex-1 rounded border border-zinc-300 px-3 py-2 text-sm"
              />
              {translations.length > 1 && (
                <button
                  type="button"
                  onClick={() =>
                    setTranslations((prev) => prev.filter((_, j) => j !== i))
                  }
                  className="text-sm text-red-500"
                >
                  삭제
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="text-sm font-medium">아티스트</label>
          <button
            type="button"
            onClick={addArtistRow}
            className="text-sm text-blue-600 hover:underline"
          >
            + 아티스트 추가
          </button>
        </div>
        <div className="space-y-2">
          {artistIds.map((aid, i) => (
            <div key={i} className="flex items-center gap-2">
              <select
                value={aid}
                onChange={(e) =>
                  setArtistIds((prev) =>
                    prev.map((id, j) => (j === i ? e.target.value : id)),
                  )
                }
                className="flex-1 rounded border border-zinc-300 px-3 py-2 text-sm"
              >
                <UnlistedArtistOption value={aid} options={artistOptions} />
                {artistOptions.map((a) => {
                  const name =
                    a.translations.find((t) => t.locale === "ko")?.name ??
                    a.translations[0]?.name ??
                    `아티스트 ID: ${a.id}`;
                  // Same guard as the locale select — disable artists
                  // already linked by another row so AlbumArtist's
                  // @@unique([albumId, artistId]) won't reject the save.
                  const usedElsewhere =
                    a.id !== aid &&
                    artistIds.some((other, j) => j !== i && other === a.id);
                  return (
                    <option key={a.id} value={a.id} disabled={usedElsewhere}>
                      {name}
                    </option>
                  );
                })}
              </select>
              <button
                type="button"
                onClick={() =>
                  setArtistIds((prev) => prev.filter((_, j) => j !== i))
                }
                className="text-sm text-red-500"
              >
                삭제
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Outside the info <form> element (the cover editor's own form
          sits between them and forms cannot nest); `form=` attaches it.
          Translations/artists are read from state, not form data. */}
      <button
        type="submit"
        form={infoFormId}
        disabled={loading}
        className="rounded bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? "저장 중..." : "앨범 정보 저장"}
      </button>
      <p className="text-xs text-zinc-500">
        앨범 정보 저장은 표지를 저장하지 않습니다.
      </p>
    </div>
  );
}
