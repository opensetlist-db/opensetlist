import type { EventDisplayText } from "@/lib/eventDisplay";

export function EventNameText({ pair }: { pair: EventDisplayText }) {
  return (
    <span className="min-w-0 text-[max(0.75rem,1em)] [overflow-wrap:anywhere]">
      <span lang={pair.mainLang}>{pair.main}</span>
      {pair.sub && (
        <small lang={pair.subLang} className="block text-[max(0.6875rem,0.86em)] font-normal">
          {pair.sub}
        </small>
      )}
    </span>
  );
}
