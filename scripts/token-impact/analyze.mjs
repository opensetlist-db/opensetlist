import ts from "typescript";
import path from "node:path";
import { createRequire } from "node:module";

// Reuse the parsers already owned by stylelint, as the palette tools do.
const require = createRequire(import.meta.url);
const cssRequire = createRequire(require.resolve("stylelint/package.json"));
const postcss = cssRequire("postcss");
const valueParser = cssRequire("postcss-value-parser");
const scriptFile = /\.[cm]?[jt]sx?$/;
const normalize = (file) => path.posix.normalize(file.replaceAll("\\", "/")).replace(/^\.\//, "");
const unwrap = (node) => {
  while (node && (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node) || ts.isTypeAssertionExpression(node))) node = node.expression;
  return node;
};
const nameOf = (node) => node && (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) ? node.text : null;
const roleOf = (property) => /^(color|fill|stroke|.*TextFillColor)$/i.test(property) ? "foreground"
  : /background/i.test(property) ? "background / decoration — verify element role"
  : /border|outline|shadow/i.test(property) ? "edge / effect" : "unknown — manual trace required";

function context(node, source) {
  let property = "unknown", component = "module";
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (property === "unknown" && (ts.isPropertyAssignment(parent) || ts.isJsxAttribute(parent))) property = nameOf(parent.name) ?? parent.name.getText(source);
    if (component === "module" && (ts.isFunctionDeclaration(parent) || ts.isVariableDeclaration(parent)) && parent.name && ts.isIdentifier(parent.name)) component = parent.name.text;
  }
  return { component, property, role: roleOf(property) };
}

function cssReferences(value) {
  const refs = [];
  valueParser(value).walk((node) => {
    if (node.type !== "function") return;
    if (node.value.toLowerCase() === "url") return false;
    if (node.value.toLowerCase() !== "var") return;
    const first = node.nodes.find((part) => part.type !== "space" && part.type !== "comment");
    if (first?.type === "word" && first.value.startsWith("--")) refs.push(first.value);
  });
  return refs;
}

function snapshot(input, tokenFiles) {
  const files = new Map(Object.entries(input).map(([file, value]) => [normalize(file), value]));
  const definitions = new Map(), references = [], diagnostics = [];
  const tokenNodes = new Map(), prefixNodes = new Map();
  const scripts = new Map([...files].filter(([file]) => scriptFile.test(file)).map(([file, text]) => [file, ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)]));
  const resolveModule = (specifier, from) => {
    const stem = specifier.startsWith("@/") ? `src/${specifier.slice(2)}` : specifier.startsWith(".") ? path.posix.join(path.posix.dirname(from), specifier) : null;
    if (!stem) return undefined;
    for (const candidate of [stem, `${stem}.ts`, `${stem}.tsx`, `${stem}.js`, `${stem}.jsx`, `${stem}/index.ts`, `${stem}/index.tsx`]) {
      if (scripts.has(candidate)) return { resolvedFileName: candidate, extension: candidate.endsWith("tsx") ? ts.Extension.Tsx : ts.Extension.Ts };
    }
    return undefined;
  };
  // A virtual compiler host sees only the supplied text. It does not load
  // tsconfig plugins, dependencies, executable config, or application code.
  const host = {
    getSourceFile: (file) => scripts.get(normalize(file)), getDefaultLibFileName: () => "",
    writeFile: () => {}, getCurrentDirectory: () => "", getDirectories: () => [],
    fileExists: (file) => files.has(normalize(file)), readFile: (file) => files.get(normalize(file)),
    getCanonicalFileName: normalize, useCaseSensitiveFileNames: () => true, getNewLine: () => "\n",
    resolveModuleNames: (names, from) => names.map((name) => resolveModule(name, from)),
  };
  const program = ts.createProgram([...scripts.keys()], { noLib: true, noResolve: false, allowJs: true, jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.Latest, module: ts.ModuleKind.ESNext }, host);
  const checker = program.getTypeChecker();
  for (const [file, source] of scripts) {
    for (const error of source.parseDiagnostics) diagnostics.push({ file, line: source.getLineAndCharacterOfPosition(error.start ?? 0).line + 1, reason: ts.flattenDiagnosticMessageText(error.messageText, " ") });
    if (!tokenFiles.includes(file)) continue;
    const flatten = (node, parts, declaration) => {
      node = unwrap(node);
      if (!node) return;
      prefixNodes.set(declaration, { file, parts });
      if (ts.isObjectLiteralExpression(node)) {
        for (const prop of node.properties) {
          if (ts.isPropertyAssignment(prop) && nameOf(prop.name) !== null) flatten(prop.initializer, [...parts, nameOf(prop.name)], prop);
          else diagnostics.push({ file, line: source.getLineAndCharacterOfPosition(prop.getStart()).line + 1, reason: `Unsupported token object member: ${prop.getText(source)}` });
        }
      } else if (ts.isArrayLiteralExpression(node)) {
        node.elements.forEach((element, index) => flatten(element, [...parts, String(index)], element));
      } else {
        const key = `${file}#${parts.join(".")}`;
        definitions.set(key, { key, kind: "typescript", file, name: parts.join("."), value: node.getText(source), line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1 });
        tokenNodes.set(declaration, key);
      }
    };
    for (const statement of source.statements) {
      if (!ts.isVariableStatement(statement) || !statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) flatten(declaration.initializer, [declaration.name.text], declaration);
        else diagnostics.push({ file, line: 1, reason: "Unsupported exported token binding" });
      }
    }
  }
  const prefixOrigins = (prefix, reason) => [...definitions.values()].filter((row) => row.file === prefix.file && (row.name === prefix.parts.join(".") || row.name.startsWith(`${prefix.parts.join(".")}.`))).map((row) => ({ key: row.key, reason }));
  const origins = (raw, seen = new Set()) => {
    const node = unwrap(raw);
    if (!node || seen.has(node)) return [];
    seen = new Set([...seen, node]);
    let symbol = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(node) ? node.name : node);
    if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    for (const declaration of symbol?.declarations ?? []) {
      if (tokenNodes.has(declaration)) return [{ key: tokenNodes.get(declaration), reason: null }, ...origins(declaration.initializer, seen).map((row) => ({ ...row, reason: "Indirect token definition; verify derived consumers" }))];
      if (prefixNodes.has(declaration)) return prefixOrigins(prefixNodes.get(declaration), "Token collection escapes or is selected dynamically; candidate set only");
      if (ts.isVariableDeclaration(declaration) && declaration.initializer) return origins(declaration.initializer, seen).map((row) => ({ ...row, reason: row.reason ?? "Indirect local binding; verify downstream use" }));
      if (ts.isPropertyAssignment(declaration)) return origins(declaration.initializer, seen).map((row) => ({ ...row, reason: row.reason ?? "Indirect object property; verify downstream use" }));
      if (ts.isBindingElement(declaration)) {
        const binding = declaration.parent.parent;
        if (ts.isVariableDeclaration(binding) && binding.initializer) return origins(binding.initializer, seen).filter((row) => row.key.endsWith(`.${nameOf(declaration.propertyName ?? declaration.name)}`)).map((row) => ({ ...row, reason: "Destructured binding; verify downstream use" }));
      }
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const base = origins(node.expression, seen);
      const name = ts.isPropertyAccessExpression(node) ? node.name.text : nameOf(node.argumentExpression);
      if (name !== null) {
        const narrowed = base.filter((row) => row.key.split("#")[1].split(".").includes(name));
        return (narrowed.length ? narrowed : base).map((row) => ({ ...row, reason: row.reason ?? "Indirect member reference; candidate set only" }));
      }
      return base.map((row) => ({ ...row, reason: "Dynamic member selection; candidate set only" }));
    }
    const indirect = [];
    // Object maps, templates, calls and conditional expressions are candidate
    // propagation only. Never infer a function's return value by executing it.
    if (ts.isObjectLiteralExpression(node) || ts.isArrayLiteralExpression(node) || ts.isTemplateExpression(node) || ts.isCallExpression(node) || ts.isConditionalExpression(node) || ts.isBinaryExpression(node)) {
      const collect = (child) => {
        if (ts.isPropertyAssignment(child)) indirect.push(...origins(child.initializer, seen));
        else if (ts.isExpression(child)) indirect.push(...origins(child, seen));
        else ts.forEachChild(child, collect);
      };
      ts.forEachChild(node, collect);
    }
    return [...new Map(indirect.map((row) => [row.key, { ...row, reason: "Indirect expression; candidate set only, manual trace required" }])).values()];
  };
  for (const [file, source] of scripts) {
    const visit = (node) => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isTypeNode(node)) return;
      if (ts.isIdentifier(node) && ((ts.isPropertyAssignment(node.parent) || ts.isVariableDeclaration(node.parent) || ts.isBindingElement(node.parent) || ts.isParameter(node.parent) || ts.isFunctionDeclaration(node.parent)) && node.parent.name === node)) return;
      if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        const matches = origins(node);
        if (matches.length) {
          for (const match of matches) references.push({ ...match, file, line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, expression: node.getText(source), ...context(node, source) });
          return;
        }
      }
      if (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node)) {
        const text = ts.isStringLiteralLike(node) ? node.text : node.getText(source);
        for (const name of cssReferences(text)) references.push({ key: `css#${name}`, file, line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, expression: text, reason: "CSS var in script string; runtime application/scope requires review", ...context(node, source) });
        if (text.includes("var(") && text.includes("${")) diagnostics.push({ file, line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, reason: "Interpolated CSS var name/value; manual trace required" });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  for (const [file, text] of files) {
    if (!file.endsWith(".css")) continue;
    let tree;
    try { tree = postcss.parse(text, { from: file }); }
    catch (error) { diagnostics.push({ file, line: error.line, reason: error.reason }); continue; }
    tree.walkDecls((decl) => {
      const selector = [];
      for (let parent = decl.parent; parent && parent.type !== "root"; parent = parent.parent) selector.unshift(parent.type === "rule" ? parent.selector : `@${parent.name} ${parent.params}`);
      const location = { file, line: decl.source.start.line, component: selector.join(" / "), property: decl.prop, role: roleOf(decl.prop) };
      if (decl.prop.startsWith("--")) {
        const key = `css#${decl.prop}`, previous = definitions.get(key);
        const value = `${file}:${selector.join(" / ")}:${decl.value}${decl.important ? " !important" : ""}`;
        definitions.set(key, { key, kind: "css", file: previous?.file ?? file, name: decl.prop, line: previous?.line ?? location.line, value: previous ? `${previous.value}\n${value}` : value });
      }
      for (const name of cssReferences(decl.value)) references.push({ key: `css#${name}`, ...location, expression: decl.value, reason: decl.prop.startsWith("--") ? "Indirect CSS custom property; scope/cascade requires review" : null });
      if (decl.prop.includes("\\") || decl.value.includes("\\")) diagnostics.push({ file, line: location.line, reason: "CSS escape spelling not resolved; manual trace required" });
    });
  }
  // Expose CSS indirection downstream without pretending to resolve cascade.
  for (let count = 0; count < definitions.size; count++) {
    let added = false;
    for (const ref of [...references]) {
      if (!ref.property.startsWith("--")) continue;
      for (const consumer of [...references]) {
        if (consumer.key !== `css#${ref.property}` || consumer.key === ref.key) continue;
        if (references.some((row) => row.key === ref.key && row.file === consumer.file && row.line === consumer.line && row.expression === consumer.expression)) continue;
        references.push({ ...consumer, key: ref.key, reason: `Indirect via ${ref.property}; scope/cascade requires review` });
        added = true;
      }
    }
    if (!added) break;
  }
  return { definitions, references, diagnostics };
}

export function analyzeImpact(before, after, { tokenFiles = ["src/styles/tokens.ts"] } = {}) {
  tokenFiles = tokenFiles.map(normalize);
  const left = snapshot(before, tokenFiles), right = snapshot(after, tokenFiles);
  const changes = [];
  for (const key of [...new Set([...left.definitions.keys(), ...right.definitions.keys()])].sort()) {
    const old = left.definitions.get(key), next = right.definitions.get(key);
    if (old?.value === next?.value) continue;
    const consumers = [];
    for (const [side, state] of [["before", left], ["after", right]]) {
      for (const ref of state.references.filter((row) => row.key === key)) consumers.push({ side, ...ref, status: ref.reason ? "unresolved" : "static reference — role needs review" });
    }
    changes.push({ key, kind: (next ?? old).kind, name: (next ?? old).name, change: !old ? "added" : !next ? "removed" : "modified", before: old ?? null, after: next ?? null, consumers, review: consumers.length ? "Review every consumer's role; record validation or exclusion evidence" : "No static consumers found; check dynamic/out-of-tree references before exclusion" });
  }
  return { schemaVersion: 1, complete: false, scope: { tokenFiles, beforeFiles: Object.keys(before).length, afterFiles: Object.keys(after).length }, changes,
    diagnostics: [...left.diagnostics.map((row) => ({ side: "before", ...row })), ...right.diagnostics.map((row) => ({ side: "after", ...row }))],
    limitations: ["Static inventory, not a complete impact analysis or a visual/contrast verdict.", "JS/TS named exports in configured token modules and CSS custom properties are compared by source expression; functions are never executed.", "@/ maps to src/; relative imports/re-exports and local bindings are traced. Other aliases, runtime mutation, arbitrary function returns, external/generated consumers, Tailwind utilities and constructed variable names require manual search.", "CSS scope, cascade, inheritance and runtime element semantics are not proven. Background use is reported for role review, never banned.", "Review before AND after references, unresolved candidate sets, parser diagnostics and consumers outside this source tree. Use docs/token-impact.md for reviewer sign-off."] };
}

const escapeCell = (text) => String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("|", "&#124;").replaceAll("`", "&#96;").replaceAll("\n", " ").replaceAll("\r", " ");
export function renderImpact(report) {
  const lines = ["# Shared token impact review", "", "Static inventory only; complete: **false**. [Reviewer instructions](https://github.com/opensetlist-db/opensetlist/blob/dev/docs/token-impact.md).", "", ...report.limitations.map((text) => `- ${escapeCell(text)}`), "", `Changed tokens: ${report.changes.length}. Parse/coverage diagnostics: ${report.diagnostics.length}.`, ""];
  for (const change of report.changes) {
    lines.push(`## ${escapeCell(change.name)} (${change.change})`, "", `Source: ${escapeCell(change.key)}`, "", `Before: ${escapeCell(change.before?.value ?? "absent")}`, `After: ${escapeCell(change.after?.value ?? "absent")}`, "", change.review, "", "| Side | Consumer:line | Component / selector | Property | Role | Status / follow-up |", "| --- | --- | --- | --- | --- | --- |");
    for (const row of change.consumers) lines.push(`| ${row.side} | ${escapeCell(row.file)}:${row.line} | ${escapeCell(row.component)} | ${escapeCell(row.property)} | ${escapeCell(row.role)} | ${escapeCell(row.reason ?? row.status)} |`);
    lines.push("", "- [ ] Each consumer: validated / excluded with evidence, reviewer and remaining uncertainty recorded in PR.", "");
  }
  if (report.diagnostics.length) lines.push("## Diagnostics requiring manual review", "", ...report.diagnostics.map((row) => `- ${escapeCell(row.side)} ${escapeCell(row.file)}:${row.line}: ${escapeCell(row.reason)}`), "");
  return lines.join("\n");
}
