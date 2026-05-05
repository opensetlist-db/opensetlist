import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";

// Coverage for `loadOgFonts()` — the cold-start hardening introduced
// after the F15 retro. The function must:
//   1. Return all 11 fonts on the happy path with no Sentry call.
//   2. Skip a single failing font, return the other 10, ping Sentry
//      with the missing name.
//   3. Treat readFile timeouts the same as failures.
//   4. Return [] (not throw) when every font fails — `@vercel/og`
//      falls back to its bundled Geist-Regular.ttf.
//   5. Cache the result so the second call hits zero readFiles.
//
// The function holds module-level state (`cachedFonts`, `inflight`),
// so each test resets the module via `vi.resetModules()` and a fresh
// dynamic import. The ogFonts.ts test file (`og-fonts.test.ts`)
// covers `titleFontSize` independently — leave it alone.

const readFileMock = vi.fn();
const captureMessageMock = vi.fn();

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    default: {
      ...actual,
      readFile: (...args: unknown[]) => readFileMock(...args),
    },
    readFile: (...args: unknown[]) => readFileMock(...args),
  };
});

vi.mock("@sentry/nextjs", () => ({
  captureMessage: (...args: unknown[]) => captureMessageMock(...args),
}));

async function importFresh() {
  vi.resetModules();
  return await import("@/lib/ogFonts");
}

beforeEach(() => {
  readFileMock.mockReset();
  captureMessageMock.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function fontBuffer(seed: number): Buffer {
  // Distinct contents per font so we can assert the right buffer
  // landed in the right slot if a future test wants to.
  return Buffer.from(`font-${seed}`);
}

describe("loadOgFonts — cold-start hardening", () => {
  it("returns all 11 fonts on the happy path with no Sentry call", async () => {
    readFileMock.mockImplementation((p: string) =>
      Promise.resolve(fontBuffer(p.length)),
    );

    const { loadOgFonts, OG_FONTS } = await importFresh();
    const fonts = await loadOgFonts();

    expect(fonts).toHaveLength(OG_FONTS.length);
    expect(new Set(fonts.map((f) => f.name))).toEqual(
      new Set(OG_FONTS.map((f) => f.name)),
    );
    expect(captureMessageMock).not.toHaveBeenCalled();
  });

  it("skips a single failing font and reports the missing name to Sentry", async () => {
    // Pull OG_FONTS from the same fresh module instance the test will
    // exercise so the indices match even if the constant ever stops
    // being structurally identical across imports. path.join normalizes
    // `/` → `\` on Windows, so compare against the basename rather than
    // the configured POSIX-style path.
    const { loadOgFonts, OG_FONTS } = await importFresh();
    const failingFontName = OG_FONTS[2].name; // NotoSansJP — a critical CJK font
    const failingBasename = OG_FONTS[2].file.split("/").pop()!;

    readFileMock.mockImplementation((p: string) => {
      if (p.includes(failingBasename)) {
        return Promise.reject(new Error("ENOENT"));
      }
      return Promise.resolve(fontBuffer(p.length));
    });

    const fonts = await loadOgFonts();

    expect(fonts).toHaveLength(OG_FONTS.length - 1);
    expect(fonts.map((f) => f.name)).not.toContain(failingFontName);

    expect(captureMessageMock).toHaveBeenCalledTimes(1);
    const [message, options] = captureMessageMock.mock.calls[0];
    expect(message).toBe("og.fonts.partial_load");
    expect(options).toMatchObject({
      level: "warning",
      extra: {
        loaded: OG_FONTS.length - 1,
        expected: OG_FONTS.length,
        missing: [failingFontName],
      },
    });
  });

  it("treats a hung readFile as a failure once the timeout elapses", async () => {
    const { loadOgFonts, OG_FONTS, FONT_READ_TIMEOUT_MS } = await importFresh();
    const hangingFontName = OG_FONTS[1].name; // NotoSansKR
    const hangingBasename = OG_FONTS[1].file.split("/").pop()!;

    // Honor the AbortSignal that `readFontWithTimeout` passes — when
    // the controller fires after FONT_READ_TIMEOUT_MS the mock should
    // reject with an AbortError, mirroring real `readFile` behavior.
    readFileMock.mockImplementation(
      (p: string, opts?: { signal?: AbortSignal }) => {
        if (p.includes(hangingBasename)) {
          return new Promise<Buffer>((_, reject) => {
            opts?.signal?.addEventListener("abort", () => {
              reject(new Error("AbortError"));
            });
          });
        }
        return Promise.resolve(fontBuffer(p.length));
      },
    );

    const promise = loadOgFonts();
    // Drain microtasks so the 10 successful reads resolve, then advance
    // past the configured timeout for the one hung read. Importing the
    // constant rather than hardcoding 5_000 keeps the test honest if
    // the production timeout ever changes.
    await vi.advanceTimersByTimeAsync(FONT_READ_TIMEOUT_MS);
    const fonts = await promise;

    expect(fonts).toHaveLength(OG_FONTS.length - 1);
    expect(fonts.map((f) => f.name)).not.toContain(hangingFontName);
    expect(captureMessageMock).toHaveBeenCalledTimes(1);
    expect(captureMessageMock.mock.calls[0][1]).toMatchObject({
      extra: { missing: [hangingFontName] },
    });
  });

  it("returns [] when every readFile fails — never throws", async () => {
    readFileMock.mockRejectedValue(new Error("ENOENT"));

    const { loadOgFonts, OG_FONTS } = await importFresh();
    const fonts = await loadOgFonts();

    expect(fonts).toEqual([]);
    expect(captureMessageMock).toHaveBeenCalledTimes(1);
    expect(captureMessageMock.mock.calls[0][1]).toMatchObject({
      extra: { loaded: 0, expected: OG_FONTS.length },
    });
  });

  it("caches the loaded fonts and skips readFile on the second call", async () => {
    readFileMock.mockImplementation((p: string) =>
      Promise.resolve(fontBuffer(p.length)),
    );

    const { loadOgFonts, OG_FONTS } = await importFresh();
    await loadOgFonts();
    expect(readFileMock).toHaveBeenCalledTimes(OG_FONTS.length);

    readFileMock.mockClear();
    const second = await loadOgFonts();

    expect(readFileMock).not.toHaveBeenCalled();
    expect(second).toHaveLength(OG_FONTS.length);
  });

  it("caches a partial load so the second call skips readFile and Sentry", async () => {
    // Pins the cache-trade-off documented inline in `loadOgFonts`:
    // a degraded set is cached so warm requests don't keep retrying
    // missing files. Sentry should fire only on the first call (the
    // load that produced the partial), not on the cache-hit second call.
    const { loadOgFonts, OG_FONTS } = await importFresh();
    const failingBasename = OG_FONTS[0].file.split("/").pop()!;

    readFileMock.mockImplementation((p: string) => {
      if (p.includes(failingBasename)) {
        return Promise.reject(new Error("ENOENT"));
      }
      return Promise.resolve(fontBuffer(p.length));
    });

    const first = await loadOgFonts();
    expect(first).toHaveLength(OG_FONTS.length - 1);
    expect(captureMessageMock).toHaveBeenCalledTimes(1);

    readFileMock.mockClear();
    captureMessageMock.mockClear();
    const second = await loadOgFonts();

    expect(readFileMock).not.toHaveBeenCalled();
    expect(captureMessageMock).not.toHaveBeenCalled();
    expect(second).toHaveLength(OG_FONTS.length - 1);
  });

  it("dedups concurrent callers via the inflight promise", async () => {
    readFileMock.mockImplementation((p: string) =>
      Promise.resolve(fontBuffer(p.length)),
    );

    const { loadOgFonts, OG_FONTS } = await importFresh();
    const [a, b, c] = await Promise.all([
      loadOgFonts(),
      loadOgFonts(),
      loadOgFonts(),
    ]);

    // Three concurrent callers should still trigger exactly one round
    // of disk reads — `inflight` shares the in-progress promise.
    expect(readFileMock).toHaveBeenCalledTimes(OG_FONTS.length);
    expect(a).toHaveLength(OG_FONTS.length);
    expect(b).toHaveLength(OG_FONTS.length);
    expect(c).toHaveLength(OG_FONTS.length);
  });
});
