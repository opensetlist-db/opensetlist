import type { ReactNode } from "react";
import type { Block, Section } from "@/lib/types/legal";
import { colors } from "@/styles/tokens";

/**
 * Tokenize backtick-delimited spans into `<code>` elements so the
 * existing inline-identifier styling (`opensetlist_anon_id` etc.)
 * survives the data-extraction round-trip. Splits on /(`[^`]+`)/ and
 * wraps the matched groups; everything else stays as plain text.
 */
function renderInline(text: string): ReactNode[] {
  return text.split(/(`[^`]+`)/).map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code
          key={i}
          className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[12px]"
          style={{ color: colors.textPrimary }}
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function BulletList({
  items,
  bulletColor,
}: {
  items: string[];
  bulletColor: string;
}) {
  return (
    <ul className="list-none p-0">
      {items.map((item, i) => (
        <li
          key={i}
          className="flex items-start gap-2 text-[13px]"
          style={{
            color: colors.textSecondary,
            lineHeight: 1.8,
            marginBottom: 2,
          }}
        >
          <span
            className="flex-shrink-0"
            style={{ color: bulletColor, paddingTop: 2 }}
          >
            ·
          </span>
          <span>{renderInline(item)}</span>
        </li>
      ))}
    </ul>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case "p":
      return (
        <p
          className="text-[13px]"
          style={{
            color: colors.textSecondary,
            lineHeight: 1.8,
            marginBottom: 10,
          }}
        >
          {renderInline(block.text)}
        </p>
      );

    case "ul":
      // Top-level bullets render with the brand-blue dot per mockup §2-3.
      return <BulletList items={block.items} bulletColor={colors.primary} />;

    case "subgroup":
      return (
        <div className="mb-3">
          <div
            className="mb-1.5 text-[12px] font-bold"
            style={{ color: colors.primary }}
          >
            {block.label}
          </div>
          {block.intro && (
            <p
              className="text-[13px]"
              style={{
                color: colors.textSecondary,
                lineHeight: 1.8,
                marginBottom: 6,
              }}
            >
              {renderInline(block.intro)}
            </p>
          )}
          {/* Subgroup bullets use the muted dot to keep the brand-blue
              accent reserved for top-level (top-of-section) lists. */}
          <BulletList items={block.items} bulletColor={colors.textMuted} />
        </div>
      );

    case "note":
      return (
        <div
          className="mt-2.5"
          style={{
            background: colors.bgSubtle,
            borderRadius: 10,
            padding: "10px 14px",
            fontSize: 12,
            color: colors.textSubtle,
            lineHeight: 1.7,
            borderLeft: `3px solid ${colors.border}`,
          }}
        >
          {renderInline(block.text)}
        </div>
      );

    case "contact":
      return (
        <a
          href={`mailto:${block.email}`}
          className="mt-1 inline-flex items-center gap-1.5 text-[13px] font-semibold"
          style={{ color: colors.primary, textDecoration: "none" }}
        >
          <span aria-hidden="true">✉</span>
          {block.email}
        </a>
      );
  }
}

interface Props {
  section: Section;
}

export function LegalSection({ section }: Props) {
  return (
    <section
      id={section.id}
      style={{
        marginBottom: 32,
        // Anchor-link offset: clears the sticky `<Nav>` plus 24px
        // breathing room. The CSS variable `--legal-anchor-offset`
        // is breakpoint-aware (76px mobile / 80px desktop, defined in
        // globals.css), so a TOC click on either viewport scrolls the
        // heading to a position that doesn't sit under the navbar.
        scrollMarginTop: "var(--legal-anchor-offset)",
      }}
    >
      <h2
        className="mb-3 text-[15px] font-bold"
        style={{
          color: colors.textPrimary,
          paddingBottom: 10,
          borderBottom: `1px solid ${colors.borderLight}`,
        }}
      >
        {section.title}
      </h2>
      {section.blocks.map((block, i) => (
        <BlockView key={i} block={block} />
      ))}
    </section>
  );
}
