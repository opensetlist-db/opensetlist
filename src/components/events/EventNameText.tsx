import type { EventDisplayText } from "@/lib/eventDisplay";

export function EventNameText({ pair }: { pair: EventDisplayText }) {
  return (
    <span className="min-w-0 [overflow-wrap:anywhere]">
      <span lang={pair.mainLang}>{pair.main}</span>
      {pair.sub && (
        <small lang={pair.subLang} className="block text-[0.82em] font-normal">
          {pair.sub}
        </small>
      )}
    </span>
  );
}
