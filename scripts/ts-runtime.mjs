import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

/** Node24 type stripping with the repository's extensionless TS/alias paths.
 * Only script processes opt in; Next and the test runners own their loaders. */
export function installTypeScriptResolver(root) {
  registerHooks({ resolve(specifier, context, next) {
    if (specifier.startsWith("@/")) {
      const file = path.join(root, "src", specifier.slice(2));
      for (const candidate of [`${file}.ts`, path.join(file, "index.ts")]) if (existsSync(candidate)) return next(pathToFileURL(candidate).href, context);
    }
    if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(candidate)) return next(candidate.href, context);
    }
    return next(specifier, context);
  } });
}
