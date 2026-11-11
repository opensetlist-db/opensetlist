type Names = {
  name: string;
  shortName: string;
  organizerName: string;
  venue?: string;
  city?: string;
};

export function sameEventNames(originals: Names, row: Names) {
  return (["name", "shortName", "organizerName", "venue", "city"] as const).flatMap((field) => {
    const original = originals[field]?.trim();
    return original && original === row[field]?.trim() ? [[field, original] as const] : [];
  });
}

export function SameEventNames({
  matches,
  checked,
  onChange,
}: {
  matches: ReturnType<typeof sameEventNames>;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  if (!matches.length) return null;
  return (
    <label className="mt-2 flex items-start gap-2 text-xs text-zinc-700">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>출처에서 이 언어도 원문과 같은 표기임을 확인했습니다: {matches.map(([, value]) => value).join(" · ")}</span>
    </label>
  );
}
