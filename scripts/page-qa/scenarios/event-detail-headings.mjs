const headings = [
  '[id^="setlist-card-"][id$="-title"]',
  '#event-impressions-title',
  '#event-info-title',
  '#event-performers-title',
  '#event-series-title',
];

const widths = [320, 375, 390, 430, 1440];

async function checkHeadings({ page, name, check }, selectors) {
  for (const selector of selectors) {
    const result = await page.locator(selector).evaluateAll((elements) => elements.map((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const rects = [...range.getClientRects()];
      const box = el.getBoundingClientRect();
      const parent = el.parentElement.getBoundingClientRect();
      const header = el.closest('[class$="__panelHead"]');
      const siblings = new Set([...el.parentElement.children, ...(header?.children ?? [])]);
      const overlap = [...siblings].some((sibling) => {
        if (sibling.contains(el)) return false;
        const peer = sibling.getBoundingClientRect();
        return box.left < peer.right && box.right > peer.left &&
          box.top < peer.bottom && box.bottom > peer.top;
      });
      return {
        text: el.textContent.trim(),
        lines: new Set(rects.filter((r) => r.width > 0).map((r) => Math.round(r.top))).size,
        width: Math.round(box.width),
        parentWidth: Math.round(parent.width),
        overflow: el.scrollWidth > el.clientWidth + 1 || box.right > parent.right + 1,
        overlap,
      };
    }));
    const [title] = result;
    check(name(`${selector}: one line without overflow or overlap`),
      result.length === 1 && title.lines === 1 && !title.overflow && !title.overlap,
      JSON.stringify(result));
  }
}

const scenario = {
  name: 'event-detail-headings',
  async run(h) {
    await h.layoutMatrix({
      // The same Fes date is event 107 in production and 109 in the dev catalog.
      path: (locale) => `/${locale}/events/109/lovelive-15th-fes-day1`,
      widths,
      cell: (cell) => checkHeadings(cell, headings),
    });
    await h.layoutMatrix({
      prefix: 'completed',
      path: (locale) => `/${locale}/events/81/niji-5th-live-cdcs-day1`,
      widths,
      cell: async (cell) => {
        await checkHeadings(cell, [...headings, '#event-bd-title']);
        const rows = await cell.page.locator('ol[class*="setlistList"] > li').count();
        cell.check(cell.name('actual setlist is populated'), rows > 0, `${rows} rows`);
        const purchase = cell.page.getByTestId('event-bd-purchase');
        cell.check(cell.name('BD purchase link is visible'), await purchase.isVisible() &&
          (await purchase.getAttribute('href'))?.endsWith('?tab=bonus'));
      },
    });
  },
};

export default scenario;
