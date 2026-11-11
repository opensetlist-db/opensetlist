"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { ADMIN_LOCALES, ADMIN_LANGUAGES } from "@/lib/adminLocales";
import { isSafeExternalUrl } from "@/lib/utils";

export type ListingFormPayload = {
  startsAt: string | null;
  endsAt: string | null;
  sourceUrl: string | null;
  storeKey: string | null;
  selectionGuide: string | null;
  includesPerformanceVideo: boolean | null;
  isBonusOption: boolean | null;
  officialOrder: number | null;
  albumId: string;
  originalStoreName: string;
  originalEditionLabel: string | null;
  originalLanguage: string;
  productUrl: string | null;
  // The schema enum has four values (active/sold_out/ended/unknown)
  // but the admin form intentionally surfaces only two — matches the
  // b03 read path that lumps sold_out + unknown into "판매중". See
  // b03-b05-album-bonus-simplification-handoff.md.
  status: "active" | "ended";
  translations: {
    locale: string;
    storeName: string | null;
    editionLabel: string | null;
  }[];
};

// Edit-side initial data carries the full enum so an existing
// sold_out / unknown row can be rendered with the right form badge
// before mapping to the 2-state toggle on save.
export type ListingInitial = Omit<ListingFormPayload, "status"> & {
  id?: string;
  status: "active" | "sold_out" | "ended" | "unknown";
};

type Props = {
  albumId: string;
  initialData?: ListingInitial;
  storeNameSuggestions: string[];
  onClose: () => void;
};

// 2-state toggle. sold_out / unknown rows from CSV import or earlier
// schema state load as `active` ("판매중") on first open; saving
// silently demotes them — accepted per the handoff (an explicit
// 매진 marker is a Phase 2 follow-up if needed).
const STATUSES: { value: ListingFormPayload["status"]; label: string }[] = [
  { value: "active", label: "판매중" },
  { value: "ended", label: "종료" },
];

function initialStatus(
  status: ListingInitial["status"] | undefined,
): ListingFormPayload["status"] {
  return status === "ended" ? "ended" : "active";
}

export default function AlbumListingFormModal({
  albumId,
  initialData,
  storeNameSuggestions,
  onClose,
}: Props) {
  const router = useRouter();
  const listId = useId();
  const [loading, setLoading] = useState(false);

  const [originalStoreName, setOriginalStoreName] = useState(
    initialData?.originalStoreName ?? "",
  );
  const [originalEditionLabel, setOriginalEditionLabel] = useState(
    initialData?.originalEditionLabel ?? "",
  );
  const [originalLanguage, setOriginalLanguage] = useState(
    initialData?.originalLanguage ?? "ja",
  );
  const [productUrl, setProductUrl] = useState(initialData?.productUrl ?? "");
  const [status, setStatus] = useState<ListingFormPayload["status"]>(
    initialStatus(initialData?.status),
  );
  const [translations, setTranslations] = useState(
    initialData?.translations ?? [],
  );

  function addTranslation() {
    const used = new Set(translations.map((t) => t.locale));
    const next = ADMIN_LOCALES.find((l) => !used.has(l));
    if (next)
      setTranslations((prev) => [
        ...prev,
        { locale: next, storeName: null, editionLabel: null },
      ]);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const value = (name: string) => String(form.get(name) ?? "").trim() || null;
    const boolean = (name: string) => value(name) === null ? null : value(name) === "true";
    const payload: ListingFormPayload = {
      startsAt: value("startsAt"),
      endsAt: value("endsAt"),
      sourceUrl: value("sourceUrl"),
      storeKey: value("storeKey"),
      selectionGuide: value("selectionGuide"),
      includesPerformanceVideo: boolean("includesPerformanceVideo"),
      isBonusOption: boolean("isBonusOption"),
      officialOrder: value("officialOrder") === null ? null : Number(value("officialOrder")),
      albumId,
      originalStoreName: originalStoreName.trim(),
      originalEditionLabel: originalEditionLabel.trim() || null,
      originalLanguage,
      productUrl: productUrl.trim() || null,
      status,
      translations: translations
        .filter((t) => t.locale)
        .map((t) => ({
          locale: t.locale,
          storeName: t.storeName?.trim() || null,
          editionLabel: t.editionLabel?.trim() || null,
        })),
    };
    const url = initialData?.id
      ? `/api/admin/album-listings/${initialData.id}`
      : "/api/admin/album-listings";
    const method = initialData?.id ? "PATCH" : "POST";
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          reviewedTranslations: form.has("reviewedTranslations"),
          removedTranslationLocales: initialData?.translations
            .filter((row) => !payload.translations.some((entry) => entry.locale === row.locale))
            .map((row) => row.locale),
        }),
      });
      if (res.ok) {
        router.refresh();
        onClose();
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form
        onSubmit={handleSubmit}
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl"
      >
        <h2 className="mb-4 text-xl font-bold">
          {initialData?.id ? "구매처 편집" : "새 구매처"}
        </h2>

        <fieldset className="my-4 space-y-3">
          <legend className="font-medium">구매 안내 정보</legend>
          <p className="text-xs text-zinc-600">시간대가 포함된 확정 시각만 입력하세요. 날짜만 확인된 경우 근거 URL을 남기고 시각은 비워 두세요.</p>
            <label className="block text-sm">
              연결 공연 영상 포함 여부
              <select name="includesPerformanceVideo" defaultValue={initialData?.includesPerformanceVideo == null ? "" : String(initialData.includesPerformanceVideo)}
                className="mt-1 w-full rounded border border-zinc-300 px-3 py-2">
                <option value="">미확인</option>
                <option value="true">포함</option>
                <option value="false">미포함</option>
              </select>
            </label>
            <label className="block text-sm">
              구매 옵션 유형
              <select name="isBonusOption" defaultValue={initialData?.isBonusOption == null ? "" : String(initialData.isBonusOption)}
                className="mt-1 w-full rounded border border-zinc-300 px-3 py-2">
                <option value="">미확인</option>
                <option value="true">특전 구매 옵션</option>
                <option value="false">특전 없는 구매 옵션</option>
              </select>
            </label>
            <label className="block text-sm">
              공식 판매점 순서
              <input name="officialOrder" type="number" defaultValue={initialData?.officialOrder ?? ""}
                min={1} step={1} placeholder="1" className="mt-1 w-full rounded border border-zinc-300 px-3 py-2" />
            </label>
            <label className="block text-sm">
              시작 시각
              <input name="startsAt" type="text" defaultValue={initialData?.startsAt ?? ""}
                placeholder="2026-11-09T10:00:00+09:00" className="mt-1 w-full rounded border border-zinc-300 px-3 py-2" />
            </label>
            <label className="block text-sm">
              종료 시각
              <input name="endsAt" type="text" defaultValue={initialData?.endsAt ?? ""}
                placeholder="2026-11-30T23:59:00+09:00" className="mt-1 w-full rounded border border-zinc-300 px-3 py-2" />
            </label>
            <label className="block text-sm">
              공식 상품 안내 URL
              <input name="sourceUrl" type="text" defaultValue={initialData?.sourceUrl ?? ""}
                placeholder="https://" className="mt-1 w-full rounded border border-zinc-300 px-3 py-2" />
            </label>
            <label className="block text-sm">
              판매점 식별 키
              <input name="storeKey" type="text" defaultValue={initialData?.storeKey ?? ""}
                placeholder="같은 판매점의 옵션에는 같은 키 사용" className="mt-1 w-full rounded border border-zinc-300 px-3 py-2" />
            </label>
            <label className="block text-sm">
              선택 안내
              <input name="selectionGuide" type="text" defaultValue={initialData?.selectionGuide ?? ""}
                placeholder="예: 상품 페이지에서 특전 B 선택" className="mt-1 w-full rounded border border-zinc-300 px-3 py-2" />
            </label>
        </fieldset>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium">
              매장 이름 (원어)
            </label>
            <input
              list={`${listId}-stores`}
              value={originalStoreName}
              onChange={(e) => setOriginalStoreName(e.target.value)}
              required
              className="w-full rounded border border-zinc-300 px-3 py-2"
              placeholder="amazon_jp / animate / sofmap / …"
            />
            <datalist id={`${listId}-stores`}>
              {storeNameSuggestions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">
              에디션 (원어, 선택)
            </label>
            <input
              value={originalEditionLabel}
              onChange={(e) => setOriginalEditionLabel(e.target.value)}
              className="w-full rounded border border-zinc-300 px-3 py-2"
              placeholder="통상반은 비워두세요"
            />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium">원어 코드</label>
            <select
              value={originalLanguage}
              onChange={(e) => setOriginalLanguage(e.target.value)}
              className="w-full rounded border border-zinc-300 px-3 py-2"
            >
              {ADMIN_LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">상태</label>
            <select
              value={status}
              onChange={(e) =>
                setStatus(e.target.value as ListingFormPayload["status"])
              }
              className="w-full rounded border border-zinc-300 px-3 py-2"
            >
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4">
          <label className="mb-1 block text-sm font-medium">구매 URL</label>
          <input
            value={productUrl}
            onChange={(e) => setProductUrl(e.target.value)}
            className="w-full rounded border border-zinc-300 px-3 py-2 font-mono text-xs"
            placeholder="https://www.amazon.co.jp/dp/... (단축 링크는 실제 상품 주소 확인 후 입력)"
          />
          {/* Early-warn before submit when the input parses to something
              other than an http(s) URL — the public purchase card /
              ListingsClient table both gate the anchor render on
              isSafeExternalUrl, so an unsafe URL saves cleanly but
              never becomes a clickable link. Showing the warning at
              input time prevents the operator from saving + only
              realizing later why the row looks plain-text on the
              public surface. The check skips empty input (the field
              is optional). */}
          {productUrl.trim() && !isSafeExternalUrl(productUrl.trim()) && (
            <p className="mt-1 text-xs text-amber-600">
              http:// 또는 https://로 시작하는 URL만 링크로 표시됩니다.
            </p>
          )}
        </div>

        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <label className="text-sm font-medium">로케일별 매장 이름</label>
            {translations.length < ADMIN_LOCALES.length && (
              <button
                type="button"
                onClick={addTranslation}
                className="text-sm text-blue-600 hover:underline"
              >
                + 로케일 추가
              </button>
            )}
          </div>
          {translations.length === 0 && (
            <p className="text-xs text-zinc-500">
              원어 외 공개 언어의 매장 표기를 출처에서 확인해 입력하세요.
            </p>
          )}
          <div className="space-y-2">
            {translations.map((tr, i) => (
              <div
                key={i}
                className="grid grid-cols-[80px_1fr_1fr_auto] gap-2 rounded border border-zinc-200 bg-zinc-50 p-2"
              >
                <select
                  value={tr.locale}
                  onChange={(e) =>
                    setTranslations((prev) =>
                      prev.map((t, j) =>
                        j === i ? { ...t, locale: e.target.value } : t,
                      ),
                    )
                  }
                  className="rounded border border-zinc-300 px-2 py-1 text-sm"
                >
                  {ADMIN_LOCALES.map((l) => {
                    // Disable locales used by other rows — the
                    // AlbumStoreListingTranslation @@unique([listingId,
                    // locale]) would reject duplicates on save.
                    const usedElsewhere =
                      l !== tr.locale &&
                      translations.some(
                        (other, j) => j !== i && other.locale === l,
                      );
                    return (
                      <option key={l} value={l} disabled={usedElsewhere}>
                        {l}
                      </option>
                    );
                  })}
                </select>
                <input
                  placeholder="매장 이름"
                  value={tr.storeName ?? ""}
                  onChange={(e) =>
                    setTranslations((prev) =>
                      prev.map((t, j) =>
                        j === i ? { ...t, storeName: e.target.value } : t,
                      ),
                    )
                  }
                  className="rounded border border-zinc-300 px-2 py-1 text-sm"
                />
                <input
                  placeholder="에디션"
                  value={tr.editionLabel ?? ""}
                  onChange={(e) =>
                    setTranslations((prev) =>
                      prev.map((t, j) =>
                        j === i ? { ...t, editionLabel: e.target.value } : t,
                      ),
                    )
                  }
                  className="rounded border border-zinc-300 px-2 py-1 text-sm"
                />
                <button
                  type="button"
                  onClick={() =>
                    setTranslations((prev) => prev.filter((_, j) => j !== i))
                  }
                  className="text-sm text-red-500"
                >
                  삭제
                </button>
              </div>
            ))}
          </div>
        </div>

        <label className="mt-4 flex items-start gap-2 text-sm">
          <input name="reviewedTranslations" type="checkbox" />
          원문을 변경했거나 동일한 표기를 사용한 경우, 한국어·영어·일본어 표기와 출처를 확인했습니다.
        </label>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={loading}
            className="rounded bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "저장 중..." : "저장"}
          </button>
        </div>
      </form>
    </div>
  );
}
