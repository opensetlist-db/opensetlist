import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server.edge";
import type { lookupPublication } from "./reader";

type Card = NonNullable<Awaited<ReturnType<typeof lookupPublication>>>;
export function eventShareHtml(card: Card, destination: string, copy: { heading: string; opening: string; open: string }) {
  const { content: c, image } = card;
  // Full HTML is returned by a Route Handler: metadata cannot be streamed
  // behind browser navigation, and no global bot-specific setting is needed.
  return "<!doctype html>" + renderToStaticMarkup(h("html", { lang: card.locale },
    h("head", null,
      h("meta", { charSet: "utf-8" }), h("meta", { name: "viewport", content: "width=device-width, initial-scale=1" }),
      h("title", null, c.title), h("meta", { name: "description", content: c.description }),
      h("meta", { name: "robots", content: "noindex, follow" }), h("link", { rel: "canonical", href: card.shareUrl }),
      ...Object.entries({ "og:type": "website", "og:url": card.shareUrl, "og:title": c.title, "og:description": c.description,
        "og:image": image.url, "og:image:type": image.mimeType, "og:image:width": String(image.width), "og:image:height": String(image.height), "og:image:alt": c.alt })
        .map(([property, content]) => h("meta", { key: property, property, content })),
      ...Object.entries({ "twitter:card": "summary_large_image", "twitter:title": c.title, "twitter:description": c.description, "twitter:image": image.url, "twitter:image:alt": c.alt })
        .map(([name, content]) => h("meta", { key: name, name, content })),
      h("style", null, "body{margin:0;background:#f5f7fb;color:#172542;font:18px/1.6 system-ui,sans-serif}main{box-sizing:border-box;width:100%;max-width:850px;margin:auto;padding:24px;overflow-wrap:anywhere}h1{font-size:clamp(24px,5vw,36px)}img{display:block;max-width:100%;height:auto}a{display:inline-block;color:#174b9c;padding:12px 4px}a:focus-visible{outline:3px solid currentColor;outline-offset:3px}"),
      h("script", { src: "/event-share-navigation.js", defer: true })),
    h("body", null, h("main", null,
      h("p", null, copy.heading), h("h1", null, c.officialEventTitle),
      c.officialSeriesTitle && c.officialSeriesTitle !== c.officialEventTitle ? h("p", null, c.officialSeriesTitle) : null,
      h("p", null, c.purposeLabel), h("p", null, copy.opening),
      h("a", { href: destination, "data-event-destination": true }, copy.open),
      h("img", { src: image.url, width: 1200, height: 630, alt: c.alt }),
    )),
  ));
}
