// Wait for a screenshot-worthy frame. This runs in the page so its deadline
// also bounds decode() promises, which can otherwise wait forever on a stalled
// image. The returned diagnostics are useful even when the deadline expires.
export async function waitForVisualReady(page, { timeoutMs = 15000, sweep = true } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("timeoutMs must be positive");
  return page.evaluate(async ({ timeoutMs, sweep }) => {
    const started = performance.now();
    const deadline = started + timeoutMs;
    const images = new Map();
    let promotedLazy = 0;
    let sweeps = 0;
    let fontError = null;
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const frame = () => Promise.race([
      new Promise((resolve) => requestAnimationFrame(() => resolve(true))),
      delay(Math.min(100, remaining())).then(() => false), // A backgrounded page may throttle frames.
    ]);
    const remaining = () => Math.max(0, deadline - performance.now());

    // An image can acquire a src during hydration, or change currentSrc at
    // a responsive breakpoint. Keep one record per element and restart its
    // decode when the selected source changes.
    function scan() {
      for (const img of images.keys()) if (!img.isConnected) images.delete(img);
      for (const img of document.images) {
        if (img.loading === "lazy") {
          img.loading = "eager";
          promotedLazy++;
        }
        const src = img.currentSrc || img.src || "";
        const old = images.get(img);
        if (old?.src === src) continue;
        const state = { src, status: "pending", reason: null };
        images.set(img, state);
        if (!src) {
          state.status = "broken";
          state.reason = "missing source";
          continue;
        }
        // complete alone also means failed; naturalWidth distinguishes it.
        if (img.complete && img.naturalWidth === 0) {
          state.status = "broken";
          state.reason = "loaded with zero natural width";
          continue;
        }
        Promise.resolve().then(() => img.decode()).then(
          () => { if (images.get(img) === state) state.status = "loaded"; },
          (error) => {
            if (images.get(img) !== state) return;
            state.status = "broken";
            state.reason = String(error?.message ?? error).slice(0, 160);
          },
        );
      }
    }

    // Scroll once through the document to trigger intersection-driven image
    // insertion as well as native loading=lazy. Restore the original position
    // before taking the eventual screenshot. A second sweep catches content
    // added while the first sweep loaded images.
    const originalScroll = { x: scrollX, y: scrollY };
    const originalBehavior = document.documentElement.style.scrollBehavior;
    const originalPriority = document.documentElement.style.getPropertyPriority("scroll-behavior");
    document.documentElement.style.setProperty("scroll-behavior", "auto", "important");
    try {
      for (let pass = 0; sweep && pass < 2 && remaining() > 0; pass++) {
        sweeps++;
        scan();
        const step = Math.max(1, Math.floor(innerHeight * 0.8));
        const height = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0);
        for (let y = 0; y < height && remaining() > 0; y += step) {
          scrollTo(0, y);
          await frame();
          scan();
        }
        scrollTo(originalScroll.x, originalScroll.y);
        scan();
        if (Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0) <= height) break;
      }
    } finally {
      scrollTo(originalScroll.x, originalScroll.y);
      if (originalBehavior) document.documentElement.style.setProperty("scroll-behavior", originalBehavior, originalPriority);
      else document.documentElement.style.removeProperty("scroll-behavior");
    }

    let stableSince = null;
    let painted = false;
    while (remaining() > 0) {
      scan();
      const pending = [...images.values()].some((state) => state.status === "pending");
      if (!pending && document.fonts.status === "loaded") {
        if (stableSince === null) stableSince = performance.now();
        // A small quiet window catches hydration that inserts or swaps an
        // image just after the previous decode resolved.
        if (performance.now() - stableSince >= 100) {
          painted = (await frame()) && (await frame());
          scan();
          if (painted && ![...images.values()].some((state) => state.status === "pending") && document.fonts.status === "loaded") break;
        }
      } else {
        stableSince = null;
      }
      await delay(Math.min(50, remaining()));
    }
    try {
      // Surfacing a rejected FontFaceSet promise is more useful than a
      // screenshot that quietly substitutes a fallback face.
      if (document.fonts.status === "loaded" && remaining() > 0) {
        const settled = await Promise.race([
          document.fonts.ready.then(() => true),
          delay(remaining()).then(() => false),
        ]);
        if (!settled) fontError = "font readiness deadline exceeded";
      }
    } catch (error) {
      fontError = String(error?.message ?? error).slice(0, 160);
    }
    scan();
    const detail = (state) => ({ src: state.src, ...(state.reason ? { reason: state.reason } : {}) });
    const states = [...images.values()];
    const pendingImages = states.filter((state) => state.status === "pending").map(detail);
    const brokenImages = states.filter((state) => state.status === "broken").map(detail);
    // FontFaceSet.ready resolves after failed font loads too. Inspect each
    // face so a fallback-rendered screenshot cannot pass as font-ready.
    const failedFaces = [...document.fonts]
      .filter((face) => face.status === "error")
      .map((face) => ({ family: face.family, style: face.style, weight: face.weight }));
    const fonts = { status: document.fonts.status, error: fontError, failedFaces };
    const timedOut = fontError === "font readiness deadline exceeded" ||
      (remaining() <= 0 && (!painted || pendingImages.length > 0 || fonts.status !== "loaded"));
    const ready = !timedOut && painted && pendingImages.length === 0 && brokenImages.length === 0 && fonts.status === "loaded" && !fontError && failedFaces.length === 0;
    return {
      ready,
      timedOut,
      elapsedMs: Math.round(performance.now() - started),
      fonts,
      images: { total: states.length, loaded: states.filter((state) => state.status === "loaded").length, promotedLazy },
      pendingImages,
      brokenImages,
      sweeps,
      painted,
    };
  }, { timeoutMs, sweep });
}
