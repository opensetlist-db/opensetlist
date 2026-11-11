import { participationSongDisplay } from "@/lib/participationSongDisplay";

export function ParticipationSongName({
  song,
  locale,
}: {
  song: Parameters<typeof participationSongDisplay>[0];
  locale: string;
}) {
  const display = participationSongDisplay(song, locale);
  return (
    <span className="[overflow-wrap:anywhere]">
      <span lang={display.mainLang}>{display.main}</span>
      {display.variant && <> (<span lang={display.variantLang}>{display.variant}</span>)</>}
      {(display.sub || display.variantSub) && (
        <span className="block text-[length:max(11px,0.85em)] font-normal opacity-80" lang={locale}>
          {display.sub}
          {display.variantSub && <> (<span>{display.variantSub}</span>)</>}
        </span>
      )}
    </span>
  );
}
