// scripts/page-qa/harness.mjs runs markupInPage() inside every
// layoutMatrix({ basics: true }) cell as the "heading markup" check. It is
// a plain DOM function, so its positive control lives here: under jsdom,
// one invalid structure of each kind FAILs and the valid counterparts
// (including a heading inside a card link, which is allowed) PASS. The
// check in the harness FAILs on `badCount > 0` or `headings === 0`.
import { afterEach, describe, it, expect } from "vitest";
import { markupInPage } from "../../../scripts/page-qa/harness.mjs";

const render = (mainHtml: string) => {
  document.body.innerHTML = `<main>${mainHtml}</main>`;
  return markupInPage();
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("markupInPage", () => {
  it("fails a heading inside a span inside summary (the ticket 33 mockup)", () => {
    const r = render(
      `<h1>Series</h1><details><summary><span class="leg__head"><h2 class="leg__title">Saitama day 1</h2></span></summary></details>`,
    );
    expect(r.headings).toBe(2);
    expect(r.badCount).toBe(1);
    expect(r.bad[0]).toBe(
      `h2.leg__title "Saitama day 1" inside <span.leg__head>; in <summary> but not its direct child`,
    );
  });

  it("fails a heading in a phrasing-only parent outside summary", () => {
    const r = render(`<h1>A</h1><button><h3>Inside a button</h3></button><label><h4>x</h4></label>`);
    expect(r.badCount).toBe(2);
    expect(r.bad[0]).toMatch(/^h3 "Inside a button" inside <button>$/);
    expect(r.bad[1]).toMatch(/^h4 "x" inside <label>$/);
  });

  it("judges a heading in a link by the link's parent", () => {
    expect(render(`<h1>A</h1><div><a href="/x"><h3>Card</h3></a></div>`).badCount).toBe(0);
    const r = render(`<h1>A</h1><span><a href="/x"><h3>Card</h3></a></span>`);
    expect(r.bad).toEqual([`h3 "Card" inside <span>`]);
  });

  it("fails more than one heading directly inside a summary", () => {
    const r = render(`<h1>A</h1><details><summary><h2>One</h2><h3>Two</h3></summary></details>`);
    expect(r.badCount).toBe(1);
    expect(r.bad[0]).toMatch(/^summary "OneTwo" 2 headings directly inside$/);
  });

  it("passes the valid structures, with the headings counted", () => {
    const r = render(
      `<h1>Series</h1>
       <details><summary><h2 class="leg__title">Saitama</h2><span class="leg__count">2 days</span></summary></details>
       <section><h2>Songs</h2><div><a href="/s"><h3>Card</h3></a></div></section>`,
    );
    expect(r).toEqual({ headings: 4, bad: [], badCount: 0 });
  });

  it("only looks inside <main>, and counts zero headings as nothing inspected", () => {
    document.body.innerHTML = `<header><span><h2>Site</h2></span></header><main><p>No headings</p></main>`;
    expect(markupInPage()).toEqual({ headings: 0, bad: [], badCount: 0 });
  });
});
