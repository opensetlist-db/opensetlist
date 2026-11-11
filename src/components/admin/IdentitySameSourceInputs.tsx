import { locales } from "@/i18n/routing";
import type { IdentitySameSources } from "@/lib/adminIdentityNames";

export function clearIdentitySameSources<T extends IdentitySameSources>(row: T): T {
  return { ...row, nameSameSource: undefined, shortNameSameSource: undefined, stageNameSameSource: undefined };
}

type NameRow = IdentitySameSources & { locale: string; name: string; shortName?: string | null; stageName?: string | null };
type Source = { originalLanguage: string; originalName: string; originalShortName?: string | null; originalStageName?: string | null };

export default function IdentitySameSourceInputs({ row, source, scope, onChange }: {
  row: NameRow;
  source: Source;
  scope?: string;
  onChange: (field: keyof IdentitySameSources, value: string) => void;
}) {
  if (row.locale === source.originalLanguage || !locales.some((locale) => locale === row.locale)) return null;

  return ([
    ["nameSameSource", "이름", row.name, source.originalName],
    ["shortNameSameSource", "짧은 이름", row.shortName, source.originalShortName],
    ["stageNameSameSource", "예명", row.stageName, source.originalStageName],
  ] as const).map(([field, label, translated, original]) => {
    if (!original?.trim() || translated?.trim() !== original.trim()) return null;
    const caption = (scope ? scope + " " : "") + label + " 동일 표기 출처 URL (" + row.locale + ")";
    return (
      <input key={field} type="url" aria-label={caption} placeholder={caption}
        value={row[field] ?? ""} onChange={(event) => onChange(field, event.target.value)}
        className="mb-2 w-full rounded border border-zinc-300 px-2 py-1 text-sm" />
    );
  });
}
