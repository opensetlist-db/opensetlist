import { MetadataRoute } from "next";
import { BASE_URL } from "@/lib/config";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      // `/api/og/` is explicitly allowed so social-card crawlers
      // (Twitterbot, Discordbot, Slackbot, etc.) can fetch the
      // dynamically-generated og:image at `/api/og/event/[id]`,
      // `/api/og/artist/[id]`, `/api/og/song/[id]`. Without this
      // allow, the broader `/api/` disallow below tells robots-
      // respecting crawlers to skip the OG endpoint entirely — the
      // page-level og:image meta tag still parses, but the image
      // never gets fetched, so X falls back to a generic small-card
      // placeholder (the F15-X symptom tracked since 2026-05-04).
      // Spec: the most-specific path rule wins, so `/api/og/` allow
      // overrides the parent `/api/` disallow for the OG subtree.
      allow: ["/", "/api/og/"],
      disallow: ["/admin/", "/api/"],
    },
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
