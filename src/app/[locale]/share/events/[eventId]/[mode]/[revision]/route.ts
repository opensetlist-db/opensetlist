import * as Sentry from "@sentry/nextjs";
import { getTranslations } from "next-intl/server";
import { lookupPublication } from "@/lib/eventOg/reader";
import { eventShareHtml } from "@/lib/eventOg/shareHtml";
import { entityPath } from "@/lib/seo/entityUrl";
import { CARD_LOCALES, type CardLocale } from "@/lib/eventOg/content";

export const dynamic = "force-dynamic";
const HEADERS = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store, max-age=0",
  "Vercel-CDN-Cache-Control": "no-store", "X-Robots-Tag": "noindex, follow" };

export async function GET(_request: Request, context: { params: Promise<{ locale: string; eventId: string; mode: string; revision: string }> }) {
  const params = await context.params;
  if (!CARD_LOCALES.includes(params.locale as CardLocale)) return new Response(null, { status: 404, headers: HEADERS });
  try {
    const card = await lookupPublication(params);
    if (!card) return new Response(null, { status: 404, headers: HEADERS });
    const t = await getTranslations({ locale: params.locale, namespace: "EventSharePage" });
    const destination = entityPath("events", params.locale, card.eventId, card.slug);
    return new Response(eventShareHtml(card, destination, { heading: t("heading"), opening: t("opening"), open: t("open") }), { headers: HEADERS });
  } catch (error) {
    console.error("[share/events] publication render failed", error);
    Sentry.captureException(error);
    // An unavailable DB is not a missing publication. No fallback OG is
    // persisted at this successful version's identity; recovery is immediate.
    return new Response(null, { status: 503, headers: { ...HEADERS, "Retry-After": "5" } });
  }
}
