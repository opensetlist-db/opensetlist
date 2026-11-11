// @vitest-environment node
import sharp from "sharp";
import { expect, it, vi } from "vitest";
import { GET } from "@/app/api/og/event/[id]/route";

const { findEvent } = vi.hoisted(() => ({ findEvent: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { event: { findFirst: findEvent } } }));
vi.mock("@/lib/ogPalette", () => ({
  deriveOgPaletteFromEvent: async () => ({ base: "#0f172a" }),
  buildMeshBackground: () => "radial-gradient(circle at 20% 30%, #0f172a 0%, transparent 50%)",
}));

const japaneseName = (originalName: string, english: string) => ({
  originalName,
  originalLanguage: "ja",
  translations: [{ locale: "en", name: english }],
});

async function renderFooter(repetitions: number) {
  findEvent.mockResolvedValueOnce({
    ...japaneseName("夏の公演".repeat(repetitions), "Summer performance ".repeat(repetitions).trim()),
    eventSeries: japaneseName("夏のツアー".repeat(repetitions), "Summer concert tour ".repeat(repetitions).trim()),
    date: new Date("2026-07-11T00:00:00Z"),
  });
  const response = await GET(new Request("https://example.com/api/og/event/1?lang=en&s=completed"), {
    params: Promise.resolve({ id: "1" }),
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toMatch(/^public,/);
  return sharp(Buffer.from(await response.arrayBuffer()))
    .extract({ left: 100, top: 480, width: 920, height: 75 })
    .png()
    .toBuffer();
}

it("keeps the date and branding in place for very long paired event names", async () => {
  const footer = await renderFooter(1);
  expect((await sharp(footer).stats()).channels[0].max).toBeGreaterThan(120);
  expect((await renderFooter(80)).equals(footer)).toBe(true);
}, 30_000);
