"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// 정정 요청 list view의 행별 조치 버튼.
// CLAUDE.md admin-i18n exemption — 한국어만, useTranslations 없음.
//
// 두 가지 액션:
//   - 해결: 운영자가 정정을 적용함. resolvedAt 스탬프 + status=resolved
//   - 기각: 정정이 잘못된 보고. resolvedAt 스탬프 + status=dismissed
// 1C에서 두 액션 모두 status 플립만 — 실제 데이터 정정은 운영자가
// 기존 admin row-edit 페이지에서 수동으로 적용 (Phase 2 polish가
// per-type 자동 적용 추가).

interface Props {
  reportId: string;
}

export function ContestReportActions({ reportId }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function act(status: "resolved" | "dismissed") {
    const label = status === "resolved" ? "해결" : "기각";
    if (!confirm(`이 정정 요청을 ${label} 처리하시겠습니까?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/contest-reports/${reportId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        router.refresh();
      } else {
        alert(`${label} 처리에 실패했습니다.`);
      }
    } catch {
      // Network failure (DNS, timeout, offline). Without this,
      // the rejection would surface as an unhandled promise
      // rejection with no operator-visible feedback — the
      // buttons re-enable in `finally` but the action never
      // ran. Mirror the non-ok branch's alert UX.
      alert(`${label} 처리 중 오류가 발생했습니다.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inline-flex gap-2">
      <button
        type="button"
        onClick={() => act("resolved")}
        disabled={busy}
        className="text-xs text-green-700 hover:underline disabled:opacity-50"
      >
        해결
      </button>
      <button
        type="button"
        onClick={() => act("dismissed")}
        disabled={busy}
        className="text-xs text-zinc-500 hover:underline disabled:opacity-50"
      >
        기각
      </button>
    </div>
  );
}
