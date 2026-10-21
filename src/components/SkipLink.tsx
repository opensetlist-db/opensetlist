"use client";

/*
 * "Skip to content" link (03 contract), the first focusable element on
 * every public page.
 *
 * Pages render their own <main>, and the shared layout cannot give it an
 * id without touching every page. So activation focuses the page's
 * <main> landmark when one exists (screen readers then announce the main
 * region), and otherwise falls back to the `#main-content` marker the
 * layout places right after the header — which is also where the plain
 * href lands if this runs before hydration.
 */
export function SkipLink({ label }: { label: string }) {
  return (
    <a
      href="#main-content"
      className="skip-link"
      onClick={(e) => {
        const main = document.querySelector("main");
        if (!main) return;
        e.preventDefault();
        if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
        main.focus();
      }}
    >
      {label}
    </a>
  );
}
