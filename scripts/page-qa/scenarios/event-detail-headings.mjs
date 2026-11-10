const headings = [
  '[id^="setlist-card-"][id$="-title"]',
  '#event-impressions-title',
  '#event-info-title',
  '#event-performers-title',
  '#event-series-title',
];

async function checkHeadings({ page, name, check }, selectors, singleLine) {
  for (const selector of selectors) {
    const result = await page.locator(selector).evaluateAll((elements) => elements.map((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const rects = [...range.getClientRects()];
      const box = el.getBoundingClientRect();
      const parent = el.parentElement.getBoundingClientRect();
      return {
        text: el.textContent.trim(),
        lines: new Set(rects.filter((r) => r.width > 0).map((r) => Math.round(r.top))).size,
        width: Math.round(box.width),
        parentWidth: Math.round(parent.width),
        overflow: el.scrollWidth > el.clientWidth + 1 || box.right > parent.right + 1,
      };
    }));
    check(name(`${selector}: ${singleLine ? 'one line without overflow' : 'no overflow'}`), result.length === 1 && (!singleLine || result[0].lines === 1) && !result[0].overflow, JSON.stringify(result));
  }
}

const scenario = {
  name: 'event-detail-headings',
  async run(h) {
    await h.layoutMatrix({
      path: (locale) => `/${locale}/events/107/lovelive-15th-fes-day1`,
      widths: [320, 375, 390, 430, 1440],
      cell: (cell) => checkHeadings(cell, headings, true),
    });
    await h.layoutMatrix({
      prefix: 'completed',
      path: (locale) => `/${locale}/events/81/niji-5th-live-cdcs-day1`,
      widths: [320, 1440],
      cell: async (cell) => {
        await checkHeadings(cell, headings, true);
        await checkHeadings(cell, ['#event-bd-title'], false);
        const rows = await cell.page.locator('ol[class*="setlistList"] > li').count();
        cell.check(cell.name('actual setlist is populated'), rows > 0, `${rows} rows`);
      },
    });
  },
};

export default scenario;
