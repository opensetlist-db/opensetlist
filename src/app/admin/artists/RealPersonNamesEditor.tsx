"use client";

import { useState } from "react";
import { locales } from "@/i18n/routing";

import IdentitySameSourceInputs, { clearIdentitySameSources } from "@/components/admin/IdentitySameSourceInputs";
import type { IdentitySameSources } from "@/lib/adminIdentityNames";

type Translation = IdentitySameSources & { locale: string; name: string; shortName?: string | null; stageName?: string | null };

export type RealPersonNames = {
  id: string;
  originalName: string;
  originalLanguage: string;
  originalShortName?: string | null;
  originalStageName?: string | null;
  translations: Translation[];
};

export default function RealPersonNamesEditor({ person, onSaved }: {
  person: RealPersonNames;
  onSaved: (person: RealPersonNames) => void;
}) {
  const [source, setSource] = useState({
    originalName: person.originalName,
    originalLanguage: person.originalLanguage,
    originalShortName: person.originalShortName ?? "",
    originalStageName: person.originalStageName ?? "",
  });
  const [rows, setRows] = useState(() => Object.fromEntries(person.translations.map((row) => [row.locale, row])));
  function updateOriginal(field: keyof typeof source, value: string) {
    setSource((current) => ({ ...current, [field]: value }));
    setRows((current) => Object.fromEntries(Object.entries(current).map(([locale, row]) => [locale, clearIdentitySameSources(row)])));
  }
  function updateTranslation(locale: string, field: "name" | "shortName" | "stageName" | keyof IdentitySameSources, value: string) {
    setRows((current) => ({ ...current, [locale]: { ...current[locale], locale, ...(!field.endsWith("SameSource") ? { [field + "SameSource"]: undefined } : {}), [field]: value } }));
  }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setError("");
    const missing = Object.values(rows).find((row) => !row.name?.trim() && (
      row.shortName?.trim() || row.stageName?.trim() ||
      person.translations.some((previous) => previous.locale === row.locale && previous.name.trim())
    ));
    if (missing) {
      setError(source.originalName + " name (" + missing.locale + ", 표기 필요)");
      return;
    }
    setSaving(true);
    try {
      const translations = Object.values(rows).filter((row) => row.name?.trim());
      const response = await fetch("/api/admin/real-people/" + person.id, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...source, translations }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(body?.error ?? "저장에 실패했습니다.");
        return;
      }
      const stored: RealPersonNames = await response.json();
      setRows(Object.fromEntries(stored.translations.map((row) => [row.locale, row])));
      onSaved(stored);
    } catch {
      setError("저장에 실패했습니다. 네트워크를 확인해 주세요.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <fieldset className="mt-3 rounded border border-zinc-300 p-2">
      <legend className="px-1 text-sm font-medium">성우/본명 표기</legend>
      <div className="my-2 flex flex-wrap gap-2">
        {([
          ["originalName", "원본 이름"], ["originalShortName", "원본 짧은 이름"], ["originalStageName", "원본 예명"],
        ] as const).map(([field, label]) => (
          <input key={field} aria-label={"성우/본명 " + label} placeholder={label}
            value={source[field]} onChange={(e) => updateOriginal(field, e.target.value)}
            className="rounded border border-zinc-300 px-2 py-1 text-sm" />
        ))}
        <select aria-label="성우/본명 원문 언어" value={source.originalLanguage}
          onChange={(e) => updateOriginal("originalLanguage", e.target.value)}
          className="rounded border border-zinc-300 px-2 py-1 text-sm">
          {[...locales, "zh-CN"].map((locale) => <option key={locale}>{locale}</option>)}
        </select>
      </div>
      {locales.map((locale) => (
        <fieldset key={locale} className="my-2 flex flex-wrap gap-2">
          <legend className="text-xs">{locale}</legend>
          {([["name", "성우/본명"], ["shortName", "성우 짧은 이름"], ["stageName", "예명"]] as const).map(([field, label]) => (
            <input key={field} aria-label={label + " (" + locale + ")"} placeholder={label}
              value={rows[locale]?.[field] ?? ""} onChange={(e) => updateTranslation(locale, field, e.target.value)}
              className="rounded border border-zinc-300 px-2 py-1 text-sm" />
          ))}
          {rows[locale] && <IdentitySameSourceInputs row={rows[locale]} source={source}
            onChange={(field, value) => updateTranslation(locale, field, value)} />}
        </fieldset>
      ))}
      {error && <p role="alert" className="mb-2 text-sm text-red-700">{error}</p>}
      <button type="button" disabled={saving} onClick={save} className="rounded border border-zinc-300 px-3 py-1 text-xs">
        {saving ? "저장 중" : "성우/본명 저장"}
      </button>
    </fieldset>
  );
}
