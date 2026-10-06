import { MetadataRoute } from "next";
import { BASE_URL } from "@/lib/config";

// Crawlers that bring no users: AI-training / answer-engine scrapers and
// low-value commercial crawlers. Every page they fetch is a server
// render (and, before the data cache, a full pooler read), so they cost
// egress without sending anyone back. Amazonbot alone was ~1,100 SSR
// renders/day in the September 2026 firewall logs; after it was listed
// here, Amazon's search crawler reappeared as `Amzn-SearchBot/0.1`
// (1,700/day on 2026-10-06) — a different token, so list both.
// SemrushBot (SEO-tool crawler, ~150/day) is in the same no-referral
// class.
//
// Deliberately NOT listed: Googlebot, Bingbot, Applebot (Siri/Spotlight
// search — distinct from Applebot-Extended, which is training-only),
// YandexBot, Baiduspider, and the social unfurlers (Twitterbot,
// Discordbot, Slackbot, facebookexternalhit, LINE) — those either
// drive search traffic or only fetch pages people actively share.
// `Google-Extended` is a robots-only token: blocking it opts out of
// Gemini training without affecting regular Googlebot crawling.
//
// robots.txt is advisory; scrapers that ignore it are handled at the
// Vercel Firewall (Bot Protection), not here.
const NO_USER_CRAWLERS = [
  "GPTBot",
  "ClaudeBot",
  "anthropic-ai",
  "CCBot",
  "Bytespider",
  "PetalBot",
  "Amazonbot",
  "Amzn-SearchBot",
  "SemrushBot",
  "meta-externalagent",
  "Applebot-Extended",
  "Google-Extended",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        // `/api/` is intentionally NOT disallowed here, even though it
        // was in earlier revisions of this file. Rationale:
        //
        // 1. No HTML page in this app links to any `/api/*` route via an
        //    href — `/api/og/<surface>/[id]` is referenced from `og:image`
        //    meta tags (which we WANT crawlers to follow), and every other
        //    `/api/*` route is reached via client-side `fetch` from
        //    components/hooks that are not crawler-traversable. Search
        //    engines therefore have no path to discover `/api/*` routes
        //    in the first place; the historical `Disallow: /api/` was
        //    defensive-but-redundant.
        //
        // 2. X (Twitter)'s robots.txt parser does NOT honor the
        //    most-specific-path-wins rule from RFC 9309 / Google's
        //    interpretation. The earlier attempt to layer
        //    `Allow: /api/og/` ahead of `Disallow: /api/` still
        //    produced an X Card Validator warning ("The image URL […]
        //    may be restricted by the site's robots.txt file") and X
        //    refused to fetch the og:image. Verified 2026-05-18 against
        //    the live deploy. Dropping the parent disallow is the only
        //    way to be unambiguous across all parsers — X's, Discord's,
        //    Slack's, facebookexternalhit's, LinkedInBot's, etc.
        //
        // `/admin/` stays disallowed — admin routes are session-cookie
        // protected at the app layer, but the disallow is cheap belt-
        // and-suspenders so search engines don't waste crawl budget on
        // a login-walled subtree they can't index anyway.
        allow: "/",
        disallow: "/admin/",
      },
      // A crawler obeys only the most specific group matching its UA, so
      // these named groups fully replace the `*` group for them.
      { userAgent: NO_USER_CRAWLERS, disallow: "/" },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
