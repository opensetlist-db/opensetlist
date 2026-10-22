import type { ReactNode } from "react";
import type { Block, Section } from "@/lib/types/legal";
import styles from "./legal.module.css";

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
        <code key={i} className={styles.code}>
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

// Native list with a brand-blue `::marker` (34-v1) instead of the old
// hand-drawn "·" spans, so screen readers announce a list of N items.
function BulletList({ items }: { items: string[] }) {
  return (
    <ul className={styles.list}>
      {items.map((item, i) => (
        <li key={i}>{renderInline(item)}</li>
      ))}
    </ul>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case "p":
      return <p className={styles.paragraph}>{renderInline(block.text)}</p>;

    case "ul":
      return <BulletList items={block.items} />;

    case "subgroup":
      // Subgroup labels are real h3s under the section h2 (34-v1
      // h1 → h2 → h3 outline); before they were styled divs.
      return (
        <div>
          <h3 className={styles.subTitle}>{renderInline(block.label)}</h3>
          {block.intro && (
            <p className={styles.paragraph}>{renderInline(block.intro)}</p>
          )}
          <BulletList items={block.items} />
        </div>
      );

    case "note":
      return <div className={styles.note}>{renderInline(block.text)}</div>;

    case "contact":
      return (
        <a href={`mailto:${block.email}`} className={styles.contact}>
          {block.email}
        </a>
      );
  }
}

interface Props {
  section: Section;
}

export function LegalSection({ section }: Props) {
  const headingId = `heading-${section.id}`;
  return (
    // `id` is the anchor the TOCs link to — unchanged from the source
    // content so existing deep links keep working. tabIndex={-1} lets
    // LegalToc move focus here after a jump; scroll-margin lives in CSS.
    <section
      id={section.id}
      tabIndex={-1}
      aria-labelledby={headingId}
      className={styles.section}
    >
      <h2 id={headingId} className={styles.sectionTitle}>
        {section.title}
      </h2>
      {section.blocks.map((block, i) => (
        <BlockView key={i} block={block} />
      ))}
    </section>
  );
}
