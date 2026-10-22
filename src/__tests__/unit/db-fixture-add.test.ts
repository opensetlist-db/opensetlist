// @vitest-environment node
//
// scripts/db-fixture-add.mjs inserts QA fixture rows into the shared dev
// DB. Its argument and spec checks (the `[QA] ` prefix, strict spec
// fields, key references) run before any connection, and the delete
// command it prints must be one db-fixture-rm accepts unchanged — both
// pinned here. No database.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { assetKeyPrefix, buildPlan, devBucketBase, parseArgs, readJson, rmCommand, UsageError } from "../../../scripts/db-fixture-add.mjs";
import { parseArgs as rmParseArgs } from "../../../scripts/db-fixture-rm.mjs";

const MS = 1792600000000;
const RUN = { prefix: "[QA] AlbumListQA", ms: MS };

/** Split a printed command line: plain words and double-quoted strings. */
function argvOf(command: string): string[] {
  return [...command.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]).slice(2);
}

describe("buildPlan", () => {
  it("names and slugs every row from the run prefix", () => {
    const plan = buildPlan(
      {
        albums: [
          { key: "cover", releaseDate: "2099-01-01", imageUrl: "https://images.test.invalid/a.jpg", artistIds: ["4", 5] },
          { key: "undated", name: "No date" },
        ],
      },
      RUN,
    );
    expect(plan.prefix).toBe(`[QA] AlbumListQA ${MS} `);
    expect(plan.slugPrefix).toBe(`albumlistqa-${MS}-`);
    expect(plan.albums.map((a) => [a.slug, a.title])).toEqual([
      [`albumlistqa-${MS}-cover`, `[QA] AlbumListQA ${MS} cover`],
      [`albumlistqa-${MS}-undated`, `[QA] AlbumListQA ${MS} No date`],
    ]);
    expect(plan.artistIds).toEqual(["4", "5"]);
    expect(plan.count).toBe(2);
  });

  it("resolves series / event / album references by key", () => {
    const plan = buildPlan(
      {
        fixture: { artistId: "1", slug: "hasunosora" },
        albums: [{ key: "bd" }],
        series: [{ key: "tour", type: "concert_tour", artistId: "1" }, { key: "leg", parentSeries: "tour" }],
        events: [{ key: "day1", startTime: "2099-01-01T09:00:00Z", series: "leg", bdAlbum: "bd" }],
      },
      RUN,
    );
    expect(plan.count).toBe(4);
    expect(plan.extras).toEqual({ artistId: "1", slug: "hasunosora" });
    expect(plan.events[0]).toMatchObject({ series: "leg", bdAlbum: "bd", startTime: "2099-01-01T09:00:00Z" });
  });

  it.each([
    ["a non-object spec", []],
    ["no rows", { albums: [] }],
    ["an unknown top-level field", { album: [{ key: "a" }] }],
    ["an unknown row field", { albums: [{ key: "a", releasedate: "2099-01-01" }] }],
    ["a missing key", { albums: [{ name: "x" }] }],
    ["an uppercase key", { albums: [{ key: "Cover" }] }],
    ["a duplicate key across kinds", { albums: [{ key: "a" }], series: [{ key: "a" }] }],
    ["a key colliding with fixture", { fixture: { cover: "x" }, albums: [{ key: "cover" }] }],
    ["an impossible date", { albums: [{ key: "a", releaseDate: "2099-02-30" }] }],
    ["a two-digit-era year", { albums: [{ key: "a", releaseDate: "0099-01-01" }] }],
    ["a non-http image URL", { albums: [{ key: "a", imageUrl: "javascript:alert(1)" }] }],
    ["an empty artist list", { albums: [{ key: "a", artistIds: [] }] }],
    ["a non-numeric artist id", { albums: [{ key: "a", artistIds: ["4x"] }] }],
    ["an event without startTime", { events: [{ key: "e" }] }],
    ["a startTime without offset", { events: [{ key: "e", startTime: "2099-01-01T09:00:00" }] }],
    ["an event on an unknown series", { events: [{ key: "e", startTime: "2099-01-01T09:00:00Z", series: "nope" }] }],
    ["a parent series declared later", { series: [{ key: "child", parentSeries: "parent" }, { key: "parent" }] }],
    ["a bdAlbum that is not an album key", { series: [{ key: "s" }], events: [{ key: "e", startTime: "2099-01-01T09:00:00Z", bdAlbum: "s" }] }],
    ["a non-scalar fixture value", { fixture: { ids: [1] }, albums: [{ key: "a" }] }],
    ["too many rows", { albums: Array.from({ length: 21 }, (_, i) => ({ key: `a${i}` })) }],
    ["a multi-line name", { albums: [{ key: "a", name: "one\ntwo" }] }],
    ["a name over 100 chars", { albums: [{ key: "a", name: "x".repeat(101) }] }],
  ])("refuses %s", (_name, spec) => {
    expect(() => buildPlan(spec, RUN)).toThrow(UsageError);
  });
});

describe("buildPlan — logos", () => {
  const BUCKET = "https://pub-0123abcd.r2.dev/";
  const LOGO = { ...RUN, bucketBase: BUCKET };

  it("plans a custom parent with its own asset and an inheriting child", () => {
    const plan = buildPlan(
      {
        series: [
          { key: "parent", logoMode: "custom", logoAsset: { width: 400, height: 200 } },
          { key: "child", parentSeries: "parent", logoMode: "inherit" },
        ],
        events: [{ key: "day1", startTime: "2099-01-01T09:00:00Z", series: "child", logoAsset: { publicUrl: `${BUCKET}test/smoke/a.webp`, width: 10, height: 10 } }],
      },
      LOGO,
    );
    expect(plan.series.map((s) => [s.key, s.logoMode])).toEqual([["parent", "custom"], ["child", "inherit"]]);
    expect(plan.series[0]).not.toHaveProperty("logoAsset");
    // A logoAsset without logoMode is custom.
    expect(plan.events[0].logoMode).toBe("custom");
    expect(plan.assets).toEqual([
      {
        owner: "parent",
        objectKey: `qa-fixture/albumlistqa-${MS}-parent.png`,
        publicUrl: `https://images.test.invalid/albumlistqa-${MS}-parent.png`,
        mimeType: "image/png",
        needsHead: false,
        width: 400,
        height: 200,
      },
      {
        owner: "day1",
        objectKey: `qa-fixture/albumlistqa-${MS}-day1.webp`,
        publicUrl: `${BUCKET}test/smoke/a.webp`,
        mimeType: "image/webp",
        needsHead: true,
        width: 10,
        height: 10,
      },
    ]);
    // Assets count toward the row total (and db-fixture-rm's --expect).
    expect(plan.count).toBe(5);
    expect(plan.assets.every((a) => a.objectKey.startsWith(assetKeyPrefix(plan.slugPrefix)))).toBe(true);
  });

  it("allows typography without an asset", () => {
    expect(buildPlan({ series: [{ key: "s", logoMode: "typography" }] }, RUN).series[0].logoMode).toBe("typography");
  });

  const asset = (publicUrl?: string) => ({ width: 1, height: 1, ...(publicUrl === undefined ? {} : { publicUrl }) });
  it.each([
    ["an unknown logo mode", { series: [{ key: "s", logoMode: "auto" }] }],
    ["custom without an asset", { series: [{ key: "s", logoMode: "custom" }] }],
    ["an asset with typography", { series: [{ key: "s", logoMode: "typography", logoAsset: asset() }] }],
    ["an asset with inherit", { events: [{ key: "e", startTime: "2099-01-01T09:00:00Z", logoMode: "inherit", logoAsset: asset() }] }],
    ["a logo on an album", { albums: [{ key: "a", logoAsset: asset() }] }],
    ["an unknown asset field", { series: [{ key: "s", logoAsset: { ...asset(), byteSize: 3 } }] }],
    ["a zero width", { series: [{ key: "s", logoAsset: { width: 0, height: 1 } }] }],
    ["a fractional height", { series: [{ key: "s", logoAsset: { width: 1, height: 1.5 } }] }],
    ["a missing height", { series: [{ key: "s", logoAsset: { width: 1 } }] }],
    ["a prod-domain URL", { series: [{ key: "s", logoAsset: asset("https://img.opensetlist.com/prod/x.png") }] }],
    ["a dev-bucket URL outside test/", { series: [{ key: "s", logoAsset: asset(`${BUCKET}dev/album-cover/1/a.jpg`) }] }],
    ["a test/ URL walking out with ..", { series: [{ key: "s", logoAsset: asset(`${BUCKET}test/../dev/a.png`) }] }],
    ["a look-alike test host", { series: [{ key: "s", logoAsset: asset("https://images.test.invalid.evil.com/a.png") }] }],
    ["an http test URL", { series: [{ key: "s", logoAsset: asset("http://images.test.invalid/a.png") }] }],
    ["a query string", { series: [{ key: "s", logoAsset: asset("https://images.test.invalid/a.png?x=1") }] }],
    ["an unsupported extension", { series: [{ key: "s", logoAsset: asset("https://images.test.invalid/a.svg") }] }],
    [
      "two assets with one URL",
      { series: [{ key: "a", logoAsset: asset("https://images.test.invalid/x.png") }, { key: "b", logoAsset: asset("https://images.test.invalid/x.png") }] },
    ],
  ])("refuses %s", (_name, spec) => {
    expect(() => buildPlan(spec, LOGO)).toThrow(UsageError);
  });

  it("refuses a dev-bucket URL when the env names no dev bucket", () => {
    expect(() => buildPlan({ series: [{ key: "s", logoAsset: asset(`${BUCKET}test/a.png`) }] }, RUN)).toThrow(UsageError);
  });
});

describe("devBucketBase", () => {
  it.each([
    ["https://pub-0123abcd.r2.dev", "https://pub-0123abcd.r2.dev/"],
    ["https://pub-0123abcd.r2.dev/", "https://pub-0123abcd.r2.dev/"],
    ["https://img.opensetlist.com", null],
    ["http://pub-0123abcd.r2.dev", null],
    ["https://pub-0123abcd.r2.dev/?x=1", null],
    ["not a url", null],
    [undefined, null],
  ])("%s → %s", (raw, base) => {
    expect(devBucketBase(raw)).toBe(base);
  });
});

describe("parseArgs", () => {
  it("takes the spec inline or from a file", () => {
    const inline = parseArgs(["--prefix", "[QA] T", "--spec", '{"albums":[{"key":"a"}]}', "--dry-run"]);
    expect(inline).toMatchObject({ prefix: "[QA] T", spec: { albums: [{ key: "a" }] }, out: null, dryRun: true });

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fixture-add-"));
    try {
      const file = path.join(dir, "spec.json");
      fs.writeFileSync(file, '{"albums":[{"key":"b"}]}');
      expect(parseArgs(["--spec", file, "--prefix", "[QA] T", "--out", "x.json"])).toMatchObject({ spec: { albums: [{ key: "b" }] }, out: "x.json" });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each([
    ["no --prefix", ["--spec", "{}"]],
    ["no --spec", ["--prefix", "[QA] T"]],
    ["a prefix without [QA]", ["--prefix", "QA T", "--spec", "{}"]],
    ["a bare [QA] prefix", ["--prefix", "[QA] ", "--spec", "{}"]],
    ["an over-long prefix", ["--prefix", `[QA] ${"x".repeat(41)}`, "--spec", "{}"]],
    ["a prefix with shell characters", ["--prefix", '[QA] T"$(x)', "--spec", "{}"]],
    ["a flag eaten as a value", ["--prefix", "--spec", "{}"]],
    ["broken inline JSON", ["--prefix", "[QA] T", "--spec", "{albums"]],
    ["a missing spec file", ["--prefix", "[QA] T", "--spec", "no/such/spec.json"]],
    ["an unknown argument", ["--prefix", "[QA] T", "--spec", "{}", "--force"]],
  ])("refuses %s", (_name, argv) => {
    expect(() => parseArgs(argv)).toThrow(UsageError);
  });

  it("reads leading-whitespace JSON as inline", () => {
    expect(readJson("--x", '  {"a":1}')).toEqual({ a: 1 });
  });
});

describe("rmCommand", () => {
  it("prints a db-fixture-rm command that db-fixture-rm accepts as is", () => {
    const prefix = `[QA] AlbumListQA ${MS} `;
    const cmd = rmCommand(prefix, { series: ["41"], events: ["901", "902"], albums: ["505"] });
    expect(cmd).toBe(`node scripts/db-fixture-rm.mjs --prefix "${prefix}" --expect 4 --series 41 --events 901,902 --albums 505`);
    expect(rmParseArgs(argvOf(cmd))).toMatchObject({
      prefix,
      expect: 4,
      ids: { EventSeries: ["41"], Event: ["901", "902"], Album: ["505"], ImageAsset: [] },
    });
  });

  it("includes logo assets with their objectKey prefix, counted in --expect", () => {
    const prefix = `[QA] SeriesLogoQA ${MS} `;
    const assetPrefix = assetKeyPrefix(`serieslogoqa-${MS}-`);
    const asset = "0b6f3d2e-6a4c-4f0e-9d8a-2c1b3a4d5e6f";
    const cmd = rmCommand(prefix, { series: ["41", "42"], events: [], albums: [], assets: [asset] }, assetPrefix);
    expect(cmd).toBe(
      `node scripts/db-fixture-rm.mjs --prefix "${prefix}" --expect 3 --series 41,42 --assets ${asset} --asset-prefix "qa-fixture/serieslogoqa-${MS}-"`,
    );
    expect(rmParseArgs(argvOf(cmd))).toMatchObject({
      prefix,
      assetPrefix,
      expect: 3,
      ids: { EventSeries: ["41", "42"], Event: [], Album: [], ImageAsset: [asset] },
    });
  });
});
