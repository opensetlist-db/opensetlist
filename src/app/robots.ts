import { MetadataRoute } from "next";
import { BASE_URL } from "@/lib/config";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
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
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
