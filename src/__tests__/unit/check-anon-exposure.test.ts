// @vitest-environment node
//
// scripts/check-anon-exposure.mjs fails migrate-dev when a public table is
// reachable by anon/authenticated and not allowlisted. The comparison is
// the part pinned here: only an unlisted exposed table fails, while a
// listed table that is no longer exposed is a note (so locking down
// existing tables later never breaks the job). No database.
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { compare, parseAllowlist } from "../../../scripts/check-anon-exposure.mjs";

describe("parseAllowlist", () => {
  it("drops comments, blank lines and surrounding whitespace", () => {
    const text = "# header\n\nSong\n  Event  # trailing comment\r\n#Album\n";
    expect([...parseAllowlist(text)]).toEqual(["Song", "Event"]);
  });

  it("does not allowlist ImageAsset in the checked-in file", () => {
    const allowed = parseAllowlist(readFileSync("prisma/anon-exposed-tables.txt", "utf8"));
    expect(allowed.has("ImageAsset")).toBe(false);
    expect(allowed.size).toBeGreaterThan(0);
  });
});

describe("compare", () => {
  const allowed = new Set(["Song", "Event", "Dropped"]);

  it("passes when every exposed table is allowlisted, noting stale entries", () => {
    const r = compare([{ name: "Song" }, { name: "Event" }], allowed);
    expect(r.offending).toEqual([]);
    expect(r.stale).toEqual(["Dropped"]);
  });

  it("reports an exposed table missing from the allowlist", () => {
    const r = compare([{ name: "Song" }, { name: "ImageAsset" }], allowed);
    expect(r.offending).toEqual([{ name: "ImageAsset" }]);
  });
});
