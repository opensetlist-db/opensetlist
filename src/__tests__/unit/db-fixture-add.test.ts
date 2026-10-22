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
import { buildPlan, parseArgs, readJson, rmCommand, UsageError } from "../../../scripts/db-fixture-add.mjs";
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
  ])("refuses %s", (_name, spec) => {
    expect(() => buildPlan(spec, RUN)).toThrow(UsageError);
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
});
