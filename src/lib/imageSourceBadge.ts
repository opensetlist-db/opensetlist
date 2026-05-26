// Image source-state classifier for admin URL inputs. Implements
// album-image-source-policy (Option D, adopted 2026-05-16): R2 is
// canonical, Amazon CDN is allowed for ASIN'd Album / Live BD rows,
// anything else surfaces a warning so the operator documents the
// temporary placeholder in `wiki/log.md`.
//
// Plain (non-"use client") module per the project's RSC-boundary
// rule (memory: feedback_rsc_boundary_constants). NEXT_PUBLIC_*
// env vars are available on both sides — Next.js inlines them into
// the client bundle at build time AND propagates them through
// process.env at server runtime — so the same `process.env` read
// works identically in either context. An earlier iteration of
// this module carried "use client" to "pin" the build-constant
// path, but doing so would break a future server component that
// wants to call classifyImageSource (the import would resolve to
// undefined at SSR). Pure function, no React, no side effects —
// stays import-anywhere safe.

export type ImageSource = {
  label: string;
  color: string;
  warn: boolean;
};

const AMAZON_HOSTS = new Set([
  "images-na.ssl-images-amazon.com",
  "m.media-amazon.com",
]);

export function classifyImageSource(url: string): ImageSource {
  if (!url) {
    return { label: "비어있음", color: "bg-zinc-100 text-zinc-500", warn: false };
  }
  let host: string;
  try {
    host = new URL(url).host.toLowerCase();
  } catch {
    return { label: "잘못된 URL", color: "bg-red-100 text-red-700", warn: true };
  }
  if (host.endsWith(".media-amazon.com") || AMAZON_HOSTS.has(host)) {
    return { label: "Amazon", color: "bg-amber-100 text-amber-700", warn: false };
  }
  const r2Host = process.env.NEXT_PUBLIC_R2_PUBLIC_HOST;
  if (r2Host && host === r2Host.toLowerCase()) {
    return { label: "R2", color: "bg-emerald-100 text-emerald-700", warn: false };
  }
  return { label: "External", color: "bg-red-100 text-red-700", warn: true };
}
