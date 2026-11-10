#!/usr/bin/env node
// Offline review for a candidate delta or a fresh post-import export.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { locales } from "../src/i18n/routing.ts";
import {
  catalogLocaleReviewIssue,
  catalogShortNameRule,
  isSameSpellingSource,
  resolveOriginalLanguage,
} from "../src/lib/csv-parse.ts";
import { resolveDisplayPair } from "../src/lib/display.ts";

const nameFields = { name: "originalName", shortName: "originalShortName" };
const titleFields = { title: "originalTitle", variantLabel: "variantLabel" };
const eventFields = { ...nameFields, organizerName: "organizerName" };
const incompleteStatuses = new Set([
  "missing-original", "missing", "unconfirmed-same", "title-review", "source-review", "ko-han",
]);

/** Match the server's trimmed cell values when binding a review to a CSV row. */
function csvCells({ header, row }) {
  return Object.fromEntries(header.map((col, index) => [col, row[index]?.trim()]));
}

/** Find other entries the candidate references through the importer columns. */
function relatedKeys({ file, ...record }) {
  const row = csvCells(record);
  const kind = file.split(/[.-]/)[0];
  const refs = [
    ["album", row.album_slug],
    ["album", row.bdAlbum_slug],
    ["artist", row.artist_slug],
    ["artist", row.artist_slugs],
    ["artist", row.parentArtist_slug],
    ["group", row.group_slugs],
    ["song", row.baseVersion_slug],
    ["song", row.parent_song_slug],
    ["member", row.event_performer_slugs],
    ["member", row.event_guest_slugs],
    ["series", row.series_slug],
  ];
  if (kind === "songs") refs.push(["song", row.slug]);
  return refs.flatMap(([entity, slugs]) =>
    (slugs ?? "").split(/\s+/).filter(Boolean).map((slug) => `${entity}:${slug}`)
  );
}

/** Map each import shape to the review fields its CSV can write. */
function csvTargets(file, cells) {
  switch (file.split(/[.-]/)[0]) {
    case "artists":
    case "groups":
      return [["", nameFields]];
    case "members":
      return [
        ["", nameFields],
        ["va_", { ...nameFields, stageName: "originalStageName" }],
      ];
    case "albums":
      return [["", { title: "originalTitle" }]];
    case "songs":
      if (cells.slug) return [["", titleFields]];
      return ["drama", "bgm"].includes(cells.track_type) ? [["", { title: "originalTitle" }]] : [];
    case "events":
      return [
        ...(cells.event_slug ? [["", { ...eventFields, venue: "originalVenue", city: "originalCity" }]] : []),
        ...(cells.series_slug ? [["series_", eventFields]] : []),
      ];
    default:
      throw new Error(`Unknown catalog CSV type: ${file}`);
  }
}

/**
 * Verify that each ready CSV row matches the reviewed effective values.
 * @param {{ key: string, csv?: { file: string, header: string[], row: string[] }[], fields: object[] }} entry
 */
export function verifyReviewedCsv({ key, csv = [], fields }) {
  if (!csv.length) throw new Error(`${key}: ready entry has no CSV rows`);
  for (const [csvIndex, record] of csv.entries()) {
    const { file } = record;
    const cells = csvCells(record);
    for (const [prefix, columns] of csvTargets(file, cells)) {
      const required = !prefix || prefix === "series_" || Object.keys(cells).some((col) => col.startsWith(prefix) && cells[col]);
      for (const [field, originalColumn] of Object.entries(columns)) {
        const originalCell = cells[prefix + originalColumn];
        const translatedCell = (locale) => cells[`${prefix}${locale}_${field}`];
        const review = fields.find((f) =>
          (f.csvIndex ?? 0) === csvIndex && (f.prefix ?? "") === prefix && f.field === field
        );
        const primary = field === "title" || field === "name";
        if (!review && ((primary && required) || originalCell || locales.some(translatedCell))) {
          throw new Error(`${key}: CSV row ${csvIndex + 1} has no review for ${prefix}${field}`);
        }
        if (!review) continue;

        const stored = review.stored;
        const language = resolveOriginalLanguage(cells[`${prefix}originalLanguage`] || stored?.originalLanguage || cells.originalLanguage);
        const original = originalCell || (field === "title" || field === "variantLabel" ? "" : translatedCell(language)) || stored?.original;
        const kind = field === "title" || (file.startsWith("events") && field === "name") ? "title" : undefined;
        if (review.original !== original || review.originalLanguage !== language || review.kind !== kind) {
          throw new Error(`${key}: CSV original differs from reviewed ${prefix}${field}`);
        }
        for (const locale of locales) {
          const translation = review.translations.find((item) => item.locale === locale);
          const value = translatedCell(locale) || stored?.translations?.find((item) => item.locale === locale)?.value || "";
          if (field === "name" && !kind && !value &&
              (Object.keys(columns).some((key) => cells[`${prefix}${locale}_${key}`]) ||
               (file.startsWith("groups") && cells[`${locale}_description`]))) {
            throw new Error(`${key}: ${prefix}${locale}_name is required for its translation row`);
          }
          if ((translation?.value ?? "") !== value ||
              (translation?.sameValueConfirmed && cells[`${prefix}${locale}_${field}_same_source`] !== translation.source)) {
            throw new Error(`${key}: CSV ${locale} ${prefix}${field} differs from reviewed value or source`);
          }
        }
      }
    }
  }
}

/** Classify stored or proposed display fields and propagate holds to dependents. */
export function reviewCatalog(entries, { audit = false } = {}) {
  const keys = new Set(entries.map(({ key }) => key));
  if (keys.size !== entries.length) throw new Error("Duplicate review key");

  const reviewed = entries.map(({ key, dependsOn = [], hold, fields, sourceCandidates, csv = [] }) => {
    const blocked = dependsOn.filter((dependency) => !keys.has(dependency));
    if (blocked.length) throw new Error(`${key}: unknown dependencies: ${blocked.join(", ")}`);
    const relationshipOnly = csv.length > 0 && csv.every((record) => !csvTargets(record.file, csvCells(record)).length);
    if (!hold && !fields.length && !relationshipOnly) throw new Error(`${key}: no reviewed fields`);

    const reasons = hold ? [hold] : [];
    const results = fields.flatMap(({
      field, kind, original, originalLanguage, originalSource, translations, stored, prefix = "", csvIndex = 0,
    }) => {
      const record = csv[csvIndex];
      const cells = record ? csvCells(record) : {};
      const full = field === "shortName" && fields.find((candidate) =>
        candidate.field === "name" && (candidate.prefix ?? "") === prefix && (candidate.csvIndex ?? 0) === csvIndex
      );
      const artistSlug = record
        ? (record.file.startsWith("artists") ? cells.slug : undefined)
        : (key.startsWith("artist:") ? key.slice("artist:".length) : undefined);
      const shortRule = full ? catalogShortNameRule(original, full.original, full.kind === "title", artistSlug) : undefined;
      const previousShortRule = full
        ? catalogShortNameRule(stored?.original, full.stored?.original, full.kind === "title", artistSlug)
        : undefined;
      const sourceChanged = !audit && !!stored && (original !== stored.original ||
        originalLanguage !== (stored.originalLanguage ?? "ja") || shortRule !== previousShortRule);
      const storedValue = (locale) => stored?.translations?.find((item) => item.locale === locale)?.value ?? "";
      if (!audit && stored && !sourceChanged &&
          locales.every((locale) => storedValue(locale) === (translations.find((item) => item.locale === locale)?.value ?? ""))) {
        return [];
      }
      if (!audit && !originalSource) reasons.push(`${field}: missing original source`);
      return locales.map((locale) => {
        const entry = translations.find((item) => item.locale === locale);
        let status = "missing-original";
        if (original?.trim()) {
          status = shortRule === "full-name" && !entry?.value?.trim() ? "full-name" : resolveDisplayPair(
            { original, originalLanguage }, translations, locale, "value",
            {
              kind: shortRule === "title" ? "title" : kind,
              sameValueConfirmed: !!entry?.sameValueConfirmed && isSameSpellingSource(entry.source),
            },
          ).status;
        }
        status = catalogLocaleReviewIssue({
          locale, value: entry?.value, originalLanguage, sourceChanged,
          submitted: audit ? undefined : cells[`${prefix}${locale}_${field}`], status,
        }) ?? status;
        const missing = incompleteStatuses.has(status);
        if (!audit && (missing || (status === "present" && !entry?.source))) {
          reasons.push(`${locale} ${field}: ${missing ? status : "missing source"}`);
        }
        return { field, locale, status, source: entry?.source };
      });
    });
    const dependencies = [...new Set([
      ...dependsOn,
      ...csv.flatMap(relatedKeys).filter((related) => related !== key && keys.has(related)),
    ])];
    return { key, dependsOn: dependencies, reasons, results, sourceCandidates };
  });

  const byKey = new Map(reviewed.map((row) => [row.key, row]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of reviewed) {
      if (row.reasons.length) continue;
      const blocked = row.dependsOn.filter((key) => byKey.get(key).reasons.length);
      if (blocked.length) {
        row.reasons.push(`waiting for: ${blocked.join(", ")}`);
        changed = true;
      }
    }
  }

  const unheld = reviewed.filter(({ reasons }) => !reasons.length);
  const held = reviewed.filter(({ reasons }) => reasons.length);
  const incomplete = unheld.filter(({ results }) =>
    results.some(({ status }) => incompleteStatuses.has(status))
  );
  const incompleteKeys = new Set(incomplete.map(({ key }) => key));
  const ready = unheld.filter(({ key }) => !incompleteKeys.has(key));
  const statuses = {};
  for (const { results } of unheld) {
    for (const { status } of results) statuses[status] = (statuses[status] ?? 0) + 1;
  }
  return { ready: ready.map(({ key }) => key), held, incomplete, statuses, reviewed };
}

/** Assemble and validate the full ready bundle before writing any output. */
function writeReadyCsvs(dir, entries, ready) {
  const keys = new Set(ready);
  const files = new Map();
  for (const entry of entries) {
    const { key, csv } = entry;
    if (!keys.has(key)) continue;
    verifyReviewedCsv(entry);
    for (const { file, header, row } of csv) {
      if (!/^[a-z0-9][a-z0-9-]*\.csv$/.test(file) ||
          row.length !== header.length ||
          header.some((cell) => !/^[a-zA-Z0-9_]+$/.test(cell)) ||
          row.some((cell) => /[\r\n]/.test(cell))) {
        throw new Error(`${key}: invalid CSV entry`);
      }
      if (!files.has(file)) files.set(file, [header]);
      const lines = files.get(file);
      if (JSON.stringify(lines[0]) !== JSON.stringify(header)) throw new Error(`${file}: header mismatch`);
      lines.push(row);
    }
  }
  const escape = (cell) => /[",]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell ?? "";
  mkdirSync(dir);
  for (const [file, rows] of files) {
    writeFileSync(join(dir, file), rows.map((row) => row.map(escape).join(",")).join("\n") + "\n", { flag: "wx" });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [file, mode, dir, extra] = process.argv.slice(2);
  if (!file || extra || (mode === "--ready-dir" ? !dir : dir || (mode && mode !== "--audit"))) {
    console.error("Usage: node scripts/catalog-display-review.mjs <review.json> [--audit | --ready-dir <new-dir>]");
    process.exit(2);
  }
  const { entries } = JSON.parse(readFileSync(file, "utf8"));
  const report = reviewCatalog(entries, { audit: mode === "--audit" });
  if (mode === "--ready-dir") writeReadyCsvs(dir, entries, report.ready);
  console.log(JSON.stringify(report, null, 2));
}
