import { titleFontSize } from "./ogFonts";

export function OgName({
  name, size, secondary = false,
}: {
  name: { main: string; sub: string | null };
  size: number;
  secondary?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignSelf: "stretch", wordBreak: "break-word", lineHeight: 1.15, fontWeight: 700, marginTop: secondary ? 12 : 0 }}>
      <div style={{ fontSize: size }}>{name.main}</div>
      {name.sub && (
        <div style={{ fontSize: Math.min(Math.round(size * 0.76), titleFontSize(name.sub).fontSize), opacity: 0.85, marginTop: 4 }}>
          {name.sub}
        </div>
      )}
    </div>
  );
}
