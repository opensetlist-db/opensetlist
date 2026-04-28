/**
 * Schema for legal-page content (privacy + terms). Each page is an
 * ordered list of sections; each section is an ordered list of blocks.
 *
 * Inline `<code>` spans inside block strings use backtick markdown
 * syntax (e.g., "stored as `opensetlist_anon_id`"). The renderer
 * tokenizes those into <code> elements at display time.
 */

export interface SubgroupBlock {
  kind: "subgroup";
  /** Sub-heading text (e.g. "자동 수집 정보 (제3자 처리자)"). */
  label: string;
  /** Optional intro paragraph rendered before the bullet list. */
  intro?: string;
  items: string[];
}

export type Block =
  | { kind: "p"; text: string }
  | { kind: "ul"; items: string[] }
  | SubgroupBlock
  | { kind: "note"; text: string }
  | { kind: "contact"; email: string };

export interface Section {
  /** Used as the `<section>` HTML id for anchor-link navigation. */
  id: string;
  title: string;
  blocks: Block[];
}

export interface LegalContent {
  /**
   * Optional preamble paragraph rendered between the document header
   * card and the body card. Use for the "OpenSetlist는…" intro that
   * the existing pages place above the first section. Locale-
   * specific (privacy ko + ja have one; privacy en + all terms don't).
   */
  intro?: string;
  sections: Section[];
  /**
   * Last-revision instant as an ISO 8601 UTC string
   * (e.g. "2026-04-22T00:00:00Z"). Stored in UTC per CLAUDE.md;
   * `formatDate()` renders it to the viewer's locale at display time.
   * Optional so the missing-locale empty-content fallback doesn't
   * have to fabricate an empty string.
   */
  lastUpdated?: string;
}
