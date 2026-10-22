"use client";

import type { MouseEvent } from "react";

interface Props {
  sections: { id: string; title: string }[];
  ariaLabel: string;
  className: string;
}

/**
 * Section table of contents — plain `#id` anchors, so the jump itself is
 * the browser's native fragment navigation (works without JS, keeps the
 * hash in the URL for the locale switcher and back button).
 *
 * The only client behaviour is focus: a fragment jump moves the
 * sequential-focus starting point but not focus itself, so a screen
 * reader stays on the TOC link. 34-v1 moves focus onto the target
 * `<section tabIndex={-1}>` after the browser has scrolled, with
 * `preventScroll` so the 24px `scroll-margin-top` position is kept.
 * Modifier clicks (new tab/window) are left alone.
 */
export function LegalToc({ sections, ariaLabel, className }: Props) {
  function handleClick(e: MouseEvent<HTMLAnchorElement>, id: string) {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    requestAnimationFrame(() => {
      document.getElementById(id)?.focus({ preventScroll: true });
    });
  }

  return (
    <nav aria-label={ariaLabel} className={className}>
      {sections.map((s) => (
        <a key={s.id} href={`#${s.id}`} onClick={(e) => handleClick(e, s.id)}>
          {s.title}
        </a>
      ))}
    </nav>
  );
}
