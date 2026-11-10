import type { ShareName } from "../shareNames";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server.edge";
import type { lookupPublication } from "./reader";

type Card = NonNullable<Awaited<ReturnType<typeof lookupPublication>>>;
export function eventShareHtml(card: Card, destination: string, copy: {
  heading: string; opening: string; open: string;
  correctionHeading: string; correctionBody: string; openCorrection: string; correctionUnavailable: string;
  suspensionHeading: string; suspensionBody: string;
}) {
  const c = card.suspended ? null : card.content;
  const image = card.suspended ? null : card.image;
  const title = c?.title ?? `${copy.suspensionHeading} | OpenSetlist`;
  const description = c?.description ?? copy.suspensionBody;
  const notice = card.suspended || !!card.correction;
  const names = c?.names;
  const series = names?.series;
  const paired = (name: ShareName) => [
    h("span", { lang: name.lang }, name.main),
    name.sub ? h("span", { className: "translated-name", lang: card.locale }, name.sub) : null,
  ];
  const translationStyle = names ? ".translated-name{display:block;font-size:.78em;font-weight:normal}" : "";
  // Full HTML is returned by a Route Handler: metadata cannot be streamed
  // behind browser navigation, and no global bot-specific setting is needed.
  return "<!doctype html>" + renderToStaticMarkup(h("html", { lang: card.locale },
    h("head", null,
      h("meta", { charSet: "utf-8" }), h("meta", { name: "viewport", content: "width=device-width, initial-scale=1" }),
      h("title", null, title), h("meta", { name: "description", content: description }),
      h("meta", { name: "robots", content: "noindex, follow" }), h("link", { rel: "canonical", href: card.shareUrl }),
      ...Object.entries({ "og:type": "website", "og:url": card.shareUrl, "og:title": title, "og:description": description,
        ...(image && c ? { "og:image": image.url, "og:image:type": image.mimeType, "og:image:width": String(image.width), "og:image:height": String(image.height), "og:image:alt": c.alt } : {}) })
        .map(([property, content]) => h("meta", { key: property, property, content })),
      ...Object.entries({ "twitter:card": image ? "summary_large_image" : "summary", "twitter:title": title, "twitter:description": description,
        ...(image && c ? { "twitter:image": image.url, "twitter:image:alt": c.alt } : {}) })
        .map(([name, content]) => h("meta", { key: name, name, content })),
      h("style", null, `body{margin:0;background:#f5f7fb;color:#172542;font:18px/1.6 system-ui,sans-serif}main{box-sizing:border-box;width:100%;max-width:850px;margin:auto;padding:24px;overflow-wrap:anywhere}h1{font-size:clamp(24px,5vw,36px)}${translationStyle}img{display:block;max-width:100%;height:auto}a{display:inline-block;color:#174b9c;padding:12px 4px}a:focus-visible{outline:3px solid currentColor;outline-offset:3px}`),
      notice ? null : h("script", { src: "/event-share-navigation.js", defer: true })),
    h("body", null, h("main", null,
      h("p", null, copy.heading), h("h1", { "data-testid": "event-share-title", ...(card.suspended ? { id: "suspension-heading" } : {}) }, ...(names ? paired(names.event) : [c?.officialEventTitle ?? copy.suspensionHeading])),
      names
        ? series && (series.main !== names.event.main || series.sub !== names.event.sub) ? h("p", null, ...paired(series)) : null
        : c?.officialSeriesTitle && c.officialSeriesTitle !== c.officialEventTitle ? h("p", null, c.officialSeriesTitle) : null,
      names?.artist ? h("p", null, ...paired(names.artist)) : null,
      names?.venue ? h("p", null, ...paired(names.venue)) : null,
      c ? h("p", null, c.purposeLabel) : null,
      card.suspended ? h("section", { "aria-labelledby": "suspension-heading", "data-testid": "event-share-suspension" }, h("p", null, copy.suspensionBody))
      : card.correction ? h("section", { "aria-labelledby": "correction-heading", "data-testid": "event-share-correction" },
        h("h2", { id: "correction-heading" }, copy.correctionHeading), h("p", null, copy.correctionBody),
        card.correction.replacementUrl
          ? h("a", { href: card.correction.replacementUrl, "data-testid": "event-share-correction-link" }, copy.openCorrection)
          : h("p", null, copy.correctionUnavailable)) : h("p", null, copy.opening),
      h("a", { href: destination, ...(!notice ? { "data-event-destination": true } : {}), "data-testid": "event-share-destination" }, copy.open),
      image && c ? h("img", { src: image.url, width: 1200, height: 630, alt: c.alt }) : null,
    )),
  ));
}
