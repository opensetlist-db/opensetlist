"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AlbumTrackFormModal from "@/components/admin/AlbumTrackFormModal";
import type { TrackInitial, TrackPattern } from "@/lib/albumTrackTypes";

export type TrackRow = {
  id: string;
  discNumber: number;
  trackNumber: number;
  pattern: TrackPattern;
  patternBadge: string;
  displayTitle: string; // resolved KO display
  songId: number | null;
  parentSongId: number | null;
  variant: string | null;
  title: string | null;
  titleLanguage: string | null;
  translations: { locale: string; title: string }[];
  selectedSongLabel: string; // KO label of song / parentSong
};

type Props = {
  albumId: string;
  tracks: TrackRow[];
};

const PATTERN_COLORS: Record<TrackPattern, string> = {
  vocal: "bg-emerald-100 text-emerald-700",
  off_vocal_w_parent: "bg-sky-100 text-sky-700",
  direct: "bg-zinc-100 text-zinc-700",
};

export default function TracksClient({ albumId, tracks }: Props) {
  const router = useRouter();
  const [modal, setModal] = useState<TrackInitial | "new" | null>(null);

  async function handleDelete(id: string) {
    if (!confirm("정말 삭제하시겠습니까?")) return;
    try {
      const res = await fetch(`/api/admin/album-tracks/${id}`, {
        method: "DELETE",
      });
      if (res.ok) router.refresh();
      else alert("삭제에 실패했습니다.");
    } catch {
      alert("삭제에 실패했습니다. 네트워크를 확인해 주세요.");
    }
  }

  // Group tracks by disc for the table; disc numbers ascending.
  const discs = Array.from(
    tracks.reduce((acc, t) => {
      if (!acc.has(t.discNumber)) acc.set(t.discNumber, []);
      acc.get(t.discNumber)!.push(t);
      return acc;
    }, new Map<number, TrackRow[]>()),
  ).sort(([a], [b]) => a - b);

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">수록곡 관리</h1>
        <button
          type="button"
          onClick={() => setModal("new")}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
        >
          + 추가
        </button>
      </div>

      {discs.length === 0 && (
        <p className="py-4 text-center text-zinc-400">
          등록된 트랙이 없습니다. CSV 가져오기 또는 &ldquo;+ 추가&rdquo;로 시작하세요.
        </p>
      )}

      {discs.map(([disc, rows]) => (
        <section key={disc} className="mb-6">
          <h2 className="mb-2 text-sm font-semibold tracking-wider text-zinc-500 uppercase">
            Disc {disc}
          </h2>
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 text-zinc-500">
              <tr>
                <th className="pb-2 w-16">트랙 #</th>
                <th className="pb-2">제목</th>
                <th className="pb-2 w-32">패턴</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows
                .slice()
                .sort((a, b) => a.trackNumber - b.trackNumber)
                .map((t) => (
                  <tr key={t.id} className="border-b border-zinc-100">
                    <td className="py-2 text-zinc-500">{t.trackNumber}</td>
                    <td className="py-2 font-medium">{t.displayTitle}</td>
                    <td className="py-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs font-medium ${PATTERN_COLORS[t.pattern]}`}
                      >
                        {t.patternBadge}
                      </span>
                    </td>
                    <td className="space-x-2 py-2 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() =>
                          setModal({
                            id: t.id,
                            albumId,
                            pattern: t.pattern,
                            discNumber: t.discNumber,
                            trackNumber: t.trackNumber,
                            songId: t.songId,
                            parentSongId: t.parentSongId,
                            variant: t.variant,
                            title: t.title,
                            titleLanguage: t.titleLanguage,
                            translations: t.translations,
                            selectedSongLabel: t.selectedSongLabel,
                          })
                        }
                        className="text-blue-600 hover:underline"
                      >
                        편집
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(t.id)}
                        className="text-red-500 hover:underline"
                      >
                        삭제
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      ))}

      {modal !== null && (
        <AlbumTrackFormModal
          albumId={albumId}
          initialData={modal === "new" ? undefined : modal}
          onClose={() => setModal(null)}
        />
      )}
    </>
  );
}
