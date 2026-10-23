import fs from "node:fs";
import { createHash } from "node:crypto";

export const WEIGHTS = [400, 500, 600, 700];
export const SPECIMEN = { latin: "OpenSetlist 0123 ", ja: "ライブ出演 音楽 ", ko: "공연곡명 한국어 " };
export const FONT_URL = /\.woff2?(?:\?|$)/;
const SUFFIX = { 400: "Regular", 500: "Medium", 600: "SemiBold", 700: "Bold" };
const TELEMETRY = /google-analytics|googletagmanager|sentry\.io|speed-insights/;

export function realWeights(rows) {
  const expected = WEIGHTS.flatMap((weight) => Object.keys(SPECIMEN).map((script) => `#foundation-${script}-${weight}`));
  return rows.length === expected.length && expected.every((selector) => {
    const matches = rows.filter((row) => row.selector === selector);
    if (matches.length !== 1) return false;
    const [, script, weight] = selector.split("-");
    const fonts = matches[0].fonts;
    // Count at least the visible characters: trailing whitespace may not be
    // painted. A single custom glyph cannot prove the diagnostic was rendered.
    const family = script === "latin" ? /^DMSans/ : /^NotoSans(?:KR|JP)/;
    return fonts.length > 0 && fonts.every((font) =>
      font.isCustomFont && font.glyphCount > 0 && /^(DMSans|NotoSansKR|NotoSansJP)/.test(font.postScriptName) && font.postScriptName.endsWith(`-${SUFFIX[weight]}`),
    ) && fonts.filter((font) => family.test(font.postScriptName)).reduce((sum, font) => sum + font.glyphCount, 0) >= [...SPECIMEN[script].replace(/\s/g, "")].length;
  });
}

export function noLoadedFaces(faces) {
  return faces.length > 0 && !faces.some((face) => face.status === "loaded");
}

export function rejectedFaces(faces) {
  return noLoadedFaces(faces) && faces.some((face) => face.status === "error");
}

export function fallbackGlyphs(rows) {
  return rows.length > 0 && rows.every((row) => row.fonts.length > 0 && row.fonts.every((font) => !font.isCustomFont && font.glyphCount > 0));
}

export function classifyRequestFailure(request, state) {
  if (TELEMETRY.test(request.url())) return "telemetry";
  if (state !== "normal" && FONT_URL.test(request.url())) return "font-fault";
  // A cancellation alone is not evidence of speculation. Active navigation
  // and ordinary API failures must continue to fail the cell.
  if (request.headers()["next-router-prefetch"] === "1" && /ERR_ABORTED|cancelled|canceled/i.test(request.failure()?.errorText ?? "")) return "prefetch-abort";
  return "unexpected";
}

export function runtimeFailures({ errors, exceptions, requests }) {
  // Chromium sometimes omits the resource URL here. The request-specific
  // classifier remains authoritative; page exceptions are never filtered.
  return [...errors.filter((error) => !/^Failed to load resource: (net::ERR_FAILED|Load failed|cancelled|canceled)/i.test(error)), ...exceptions, ...requests];
}

export function observeFontResponses(page) {
  const responses = [];
  const pending = [];
  const listener = (response) => {
    if (!FONT_URL.test(response.url())) return;
    const url = response.url();
    const status = response.status();
    // Attach the rejection handler in this event turn, before any caller
    // waits for navigation/screenshots. It records failures instead of hiding
    // them behind a later allSettled or an unhandled rejection.
    pending.push(response.body().then(
      (buffer) => responses.push({ url, status, bytes: buffer.length, sha256: createHash("sha256").update(buffer).digest("hex") }),
      (error) => responses.push({ url, status, error: String(error) }),
    ));
  };
  page.on("response", listener);
  return {
    responses,
    async finish() {
      // Font readiness precedes this boundary. Stop observing before draining
      // so requests arriving after the evidence cutoff cannot mutate it.
      page.off("response", listener);
      await Promise.all(pending);
      return responses;
    },
  };
}

export function responseErrors(responses) {
  return responses.filter((response) => response.error || response.status < 200 || response.status >= 300);
}

export function loadFontManifest(file) {
  const bytes = fs.readFileSync(file);
  const entries = JSON.parse(bytes.toString("utf8"));
  if (!Array.isArray(entries) || entries.length === 0 || entries.some((entry) =>
    typeof entry.file !== "string" || !FONT_URL.test(entry.file) || !/^[a-f0-9]{64}$/.test(entry.sha256),
  )) throw new Error("font manifest must be a nonempty array of {file, sha256} entries");
  return { sha256: createHash("sha256").update(bytes).digest("hex"), hashes: new Set(entries.map((entry) => entry.sha256)) };
}

export function verifyFontResponses(responses, manifest, { requireResponses = true } = {}) {
  const errors = responseErrors(responses).map((response) => `${response.url}: ${response.error ?? `HTTP ${response.status}`}`);
  if (requireResponses && responses.length === 0) errors.push("no font responses observed");
  for (const response of responses) {
    if (!response.error && !manifest.hashes.has(response.sha256)) errors.push(`${response.url}: SHA256 is not in the approved manifest (${response.sha256})`);
  }
  return errors;
}
