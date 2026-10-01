// @vitest-environment node
//
// Regression guard: every exported HTTP handler under src/app/api/admin must
// call verifyAdminAPI() as its first statement. Nineteen routes (including the
// CSV importer) once shipped without it and were writable by anyone; the proxy
// now gates the prefix too, but a new route must not rely on that alone.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ADMIN_API = path.resolve(__dirname, "../../app/api/admin");
const PUBLIC = new Set(["login/route.ts"]);

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return routeFiles(p);
    return name === "route.ts" ? [p] : [];
  });
}

// Index just past the `{` that opens a handler body: balance the parameter
// list's parens, then take the first `{` outside any `<…>` return type.
function bodyStart(src: string, from: number): number {
  let i = src.indexOf("(", from);
  for (let depth = 0; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")" && --depth === 0) break;
  }
  for (let angle = 0, j = i + 1; j < src.length; j++) {
    if (src[j] === "<") angle++;
    else if (src[j] === ">") angle--;
    else if (src[j] === "{" && angle === 0) return j + 1;
  }
  throw new Error("handler body not found");
}

const files = routeFiles(ADMIN_API);

describe("admin API auth coverage", () => {
  it("finds the admin route files", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(files.map((f) => [path.relative(ADMIN_API, f).replace(/\\/g, "/"), f]))(
    "%s guards every handler with verifyAdminAPI()",
    (rel, file) => {
      if (PUBLIC.has(rel)) return;
      const src = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
      const handlers = [...src.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g)];
      expect(handlers.length).toBeGreaterThan(0);
      for (const h of handlers) {
        const body = src.slice(bodyStart(src, h.index!)).replace(/^\s*(\/\/[^\n]*\n\s*)*/, "");
        expect(body, `${rel} ${h[1]}`).toMatch(/^const \w+ = await verifyAdminAPI\(\);\s*\n\s*if \(\w+\) return \w+;/);
      }
    },
  );
});
