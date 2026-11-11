import { titleFontSize } from "./ogFonts";

const lineHeight = 1.15;

function nameLineStyle(fontSize: number, heightBudget: number) {
  return {
    display: "block",
    fontSize,
    lineClamp: Math.min(3, Math.floor(heightBudget / Math.ceil(fontSize * lineHeight))),
  } as const;
}

/** Leave space for the date and branding when both versions of a name wrap. */
export function OgName({
  name, size, secondary = false,
}: {
  name: { main: string; sub: string | null };
  size: number;
  secondary?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignSelf: "stretch", wordBreak: "break-word", lineHeight, fontWeight: 700, marginTop: secondary ? 12 : 0 }}>
      <div style={nameLineStyle(size, secondary ? 76 : 168)}>{name.main}</div>
      {name.sub && (
        <div style={{
          ...nameLineStyle(Math.min(Math.round(size * 0.76), titleFontSize(name.sub).fontSize), secondary ? 56 : 92),
          opacity: 0.85,
          marginTop: 4,
        }}>
          {name.sub}
        </div>
      )}
    </div>
  );
}
