"use client";

import { useState } from "react";
import { isOfficialRank } from "@/lib/officialOrder";

export default function MembershipOrderInput({ artistId, memberId, name, value, onSaved }: {
  artistId: number;
  memberId: string;
  name: string;
  value: number | null;
  onSaved: (value: number | null) => void;
}) {
  const [draft, setDraft] = useState(value?.toString() ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function save() {
    if (saving) return;
    const text = draft.trim();
    const rank = text === "" ? null : /^-?\d+$/.test(text) ? Number(text) : NaN;
    if (!isOfficialRank(rank)) {
      setMessage("-2147483648~2147483647 정수를 입력하세요. 비우면 이 관계순만 해제합니다.");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/admin/artists/${artistId}/stage-identities`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stageIdentityId: memberId, sortOrder: rank }),
      });
      const result = await response.json();
      if (!response.ok || !isOfficialRank(result.sortOrder)) {
        throw new Error(result.error ?? "저장에 실패했습니다.");
      }
      setDraft(result.sortOrder?.toString() ?? "");
      onSaved(result.sortOrder);
      setMessage("관계순을 저장했습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  const inputId = `membership-order-${memberId}`;
  return <div data-testid="membership-order-editor" className="mt-2 space-y-1">
    <label htmlFor={inputId} className="block text-xs">{name} — 이 아티스트의 관계순</label>
    <div className="flex flex-wrap gap-2">
      <input id={inputId} type="text" inputMode="numeric" value={draft} readOnly={saving}
        onChange={(event) => { setDraft(event.target.value); setMessage(""); }}
        aria-describedby={`${inputId}-help ${inputId}-status`}
        className="w-28 rounded border border-zinc-300 px-2 py-1 text-sm" />
      <button type="button" aria-disabled={saving} aria-busy={saving} onClick={save}
        aria-label={`${name} 관계순 저장`}
        className="rounded border border-zinc-300 px-3 py-1 text-sm disabled:opacity-50">{saving ? "저장 중..." : "관계순 저장"}</button>
    </div>
    <p id={`${inputId}-help`} className="text-xs text-zinc-500">빈 값으로 저장하면 관계순 해제 · 기본순과 다른 소속은 유지</p>
    <p id={`${inputId}-status`} role="status" className="text-xs">{message}</p>
  </div>;
}
