import { createRequire } from "node:module";
import { converter } from "culori";

// Stylelint declares both parsers; load its installed copies without adding
// undeclared direct dependencies to this repository.
const require = createRequire(import.meta.url);
const stylelintRequire = createRequire(require.resolve("stylelint/package.json"));
const postcss = stylelintRequire("postcss");
const valueParser = stylelintRequire("postcss-value-parser");
const toRgb = converter("rgb");
const colorFunctions = new Set(["rgb", "rgba", "hsl", "hsla", "hwb", "lab", "lch", "oklab", "oklch", "color"]);

function rgba(value) {
  const parsed = toRgb(value);
  if (!parsed || ![parsed.r, parsed.g, parsed.b, parsed.alpha ?? 1].every(Number.isFinite)) return null;
  // Do not quantize alpha or channels: a tiny but real difference must fail.
  return [parsed.r, parsed.g, parsed.b, parsed.alpha ?? 1].join("/");
}

function literalColor(node) {
  if (node.type === "word" && /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(node.value)) {
    return rgba(node.value);
  }
  if (node.type === "function" && colorFunctions.has(node.value.toLowerCase())) {
    return rgba(valueParser.stringify(node));
  }
  return null;
}

function approved(variables) {
  const colors = new Map();
  for (const [name, value] of Object.entries(variables ?? {})) {
    if (!/^--[\w-]+$/.test(name)) throw new Error(`invalid approved variable ${name}`);
    const parsed = valueParser(value).nodes.filter((node) => node.type !== "space");
    if (parsed.length !== 1) throw new Error(`approved variable ${name} is not one CSS color`);
    const color = literalColor(parsed[0]);
    if (!color) throw new Error(`approved variable ${name} has unsupported color ${value}`);
    colors.set(name, color);
  }
  return colors;
}

function variableName(node) {
  if (node.type !== "function" || node.value !== "var") return null;
  const args = node.nodes.filter((child) => child.type !== "space");
  return args.length === 1 && args[0].type === "word" && /^--[\w-]+$/.test(args[0].value)
    ? args[0].value : null;
}

function addedReferences(tree, addedVariables) {
  const names = new Set(addedVariables);
  const references = [];
  if (!names.size) return references;
  function inspect(value, node, field) {
    function visit(children) {
      for (const child of children) {
        if (child.type !== "function" || child.value.toLowerCase() === "url") continue;
        if (child.value.toLowerCase() === "var") {
          const first = child.nodes.filter((part) => part.type !== "space" && part.type !== "comment")[0];
          if (first?.type === "word" && names.has(first.value)) {
            references.push({ kind: "preexisting-added-variable-reference", name: first.value,
              field, line: node.source?.start?.line });
          }
        }
        visit(child.nodes);
      }
    }
    visit(valueParser(value).nodes);
  }
  tree.walkDecls((node) => inspect(node.value, node, "value"));
  tree.walkAtRules((node) => inspect(node.params, node, "at-rule-params"));
  return references;
}

// PostCSS preserves CSS escapes in identifiers. Until this proof decodes
// them, reject such contexts instead of missing an escaped token override
// or reference. Quoted strings and URLs remain opaque data.
function unsupportedEscapes(tree) {
  const differences = [];
  const add = (node, field) => differences.push({ kind: "unsupported-identifier-escape", field, line: node.source?.start?.line });
  function inspect(value, node, field) {
    valueParser(value).walk((part) => {
      if (part.type === "function" && part.value.toLowerCase() === "url") return false;
      if ((part.type === "word" || part.type === "function") && part.value.includes("\\")) add(node, field);
    });
  }
  tree.walkDecls((node) => {
    if (node.prop.includes("\\")) add(node, "property");
    inspect(node.value, node, "value");
  });
  tree.walkAtRules((node) => {
    if (node.name.includes("\\")) add(node, "at-rule-name");
    inspect(node.params, node, "at-rule-params");
  });
  return differences;
}

function compareValues(before, after, colors, at, differences, substitutions) {
  const left = valueParser(before).nodes;
  const right = valueParser(after).nodes;
  function visit(a, b, location) {
    if (a.length !== b.length) {
      differences.push({ kind: "value-structure", at: location, before: valueParser.stringify(a), after: valueParser.stringify(b) });
      return;
    }
    for (let index = 0; index < a.length; index++) {
      const old = a[index], next = b[index], place = `${location}/${index}`;
      const oldColor = literalColor(old);
      const name = variableName(next);
      if (oldColor && name && colors.get(name) === oldColor) {
        substitutions.push({ at: place, from: valueParser.stringify(old), to: name });
        continue;
      }
      if (old.type !== next.type || old.value !== next.value || old.before !== next.before || old.after !== next.after || old.quote !== next.quote) {
        differences.push({ kind: "color-or-value", at: place, before: valueParser.stringify(old), after: valueParser.stringify(next) });
        continue;
      }
      if (old.type === "function") {
        // url() is opaque: hashes in URLs and quoted content are data.
        if (old.value.toLowerCase() === "url") {
          if (valueParser.stringify(old) !== valueParser.stringify(next)) {
            differences.push({ kind: "color-or-value", at: place, before: valueParser.stringify(old), after: valueParser.stringify(next) });
          }
        } else visit(old.nodes, next.nodes, place);
      }
    }
  }
  visit(left, right, at);
}

function liveNodes(nodes) {
  return (nodes ?? []).filter((node) => node.type !== "comment");
}

function compareTree(before, after, colors) {
  const differences = [], substitutions = [];
  function visit(oldNodes, newNodes, at) {
    const a = liveNodes(oldNodes), b = liveNodes(newNodes);
    if (a.length !== b.length) {
      differences.push({ kind: "node-count", at, before: a.length, after: b.length });
    }
    for (let index = 0; index < Math.max(a.length, b.length); index++) {
      const old = a[index], next = b[index], place = `${at}/${index}`;
      if (!old || !next) continue;
      if (old.type !== next.type) {
        differences.push({ kind: "node-type", at: place, before: old.type, after: next.type });
        continue;
      }
      if (old.type === "rule") {
        if (old.selector !== next.selector) differences.push({ kind: "selector", at: place, before: old.selector, after: next.selector });
        visit(old.nodes, next.nodes, place);
      } else if (old.type === "atrule") {
        if (old.name !== next.name || old.params !== next.params) differences.push({ kind: "at-rule", at: place, before: `${old.name} ${old.params}`, after: `${next.name} ${next.params}` });
        visit(old.nodes, next.nodes, place);
      } else if (old.type === "decl") {
        if (old.prop !== next.prop) differences.push({ kind: "property", at: place, before: old.prop, after: next.prop });
        if (Boolean(old.important) !== Boolean(next.important)) differences.push({ kind: "important", at: place, before: Boolean(old.important), after: Boolean(next.important) });
        // A descriptor such as @property initial-value cannot necessarily
        // consume var() even when a style declaration with that color can.
        // Prove substitutions only in rule declarations; leave descriptors
        // exact instead of assuming the browser treats them alike.
        const allowedColors = old.parent.type === "rule" && next.parent.type === "rule" ? colors : new Map();
        compareValues(old.value, next.value, allowedColors, place, differences, substitutions);
      }
    }
  }
  visit(before.nodes, after.nodes, "root");
  return { equal: differences.length === 0, substitutions, differences };
}

export function compareCss(beforeSource, afterSource, { variables = {}, addedVariables = [] } = {}) {
  const colors = approved(variables);
  const before = postcss.parse(beforeSource), after = postcss.parse(afterSource);
  const result = compareTree(before, after, colors);
  result.differences.push(...addedReferences(before, addedVariables));
  for (const [side, tree] of [["before", before], ["after", after]]) {
    result.differences.push(...unsupportedEscapes(tree).map((row) => ({ ...row, side })));
    tree.walkDecls((node) => {
      if (colors.has(node.prop)) result.differences.push({ kind: "scoped-approved-variable", side,
        name: node.prop, line: node.source?.start?.line });
    });
    tree.walkAtRules((node) => {
      if (node.name.toLowerCase() === "property" && colors.has(node.params.trim())) result.differences.push({ kind: "registered-approved-variable", side,
        name: node.params.trim(), line: node.source?.start?.line });
    });
  }
  result.equal = result.differences.length === 0;
  return result;
}

export function compareGlobals(beforeSource, afterSource, { variables = {}, addedVariables = [] } = {}) {
  const colors = approved(variables);
  const before = postcss.parse(beforeSource), after = postcss.parse(afterSource);
  const differences = [];
  const rootRules = (tree) => liveNodes(tree.nodes).filter((node) => node.type === "rule" && node.selector === ":root");
  const oldRoots = rootRules(before), newRoots = rootRules(after);
  differences.push(...addedReferences(before, addedVariables));
  if (oldRoots.length !== 1 || newRoots.length !== 1) {
    differences.push({ kind: "root-count", before: oldRoots.length, after: newRoots.length });
    return { equal: false, added: [], differences };
  }
  const oldDecls = liveNodes(oldRoots[0].nodes).filter((node) => node.type === "decl");
  const newDecls = liveNodes(newRoots[0].nodes).filter((node) => node.type === "decl");
  for (const [side, tree, valid] of [["before", before, oldDecls], ["after", after, newDecls]]) {
    differences.push(...unsupportedEscapes(tree).map((row) => ({ ...row, side })));
    tree.walkDecls((node) => {
      if (colors.has(node.prop) && !valid.includes(node)) differences.push({ kind: "scoped-approved-variable",
        side, name: node.prop, line: node.source?.start?.line });
    });
    tree.walkAtRules((node) => {
      if (node.name.toLowerCase() === "property" && colors.has(node.params.trim())) differences.push({ kind: "registered-approved-variable",
        side, name: node.params.trim(), line: node.source?.start?.line });
    });
  }
  const oldNames = new Set(oldDecls.map((node) => node.prop));
  const permitted = new Set(addedVariables);
  const added = newDecls.filter((node) => !oldNames.has(node.prop));
  for (const name of permitted) {
    if (oldNames.has(name)) differences.push({ kind: "added-variable-existed", name });
    if (added.filter((node) => node.prop === name).length !== 1) differences.push({ kind: "added-variable-count", name });
  }
  for (const node of added) {
    if (!permitted.has(node.prop)) differences.push({ kind: "unapproved-addition", name: node.prop });
    if (rgba(node.value) !== colors.get(node.prop)) differences.push({ kind: "variable-value", name: node.prop, actual: node.value, approved: variables[node.prop] });
    if (node.important) differences.push({ kind: "variable-important", name: node.prop });
  }
  for (const [name, color] of colors) {
    const declarations = newDecls.filter((node) => node.prop === name);
    if (declarations.length !== 1 || rgba(declarations[0].value) !== color) {
      differences.push({ kind: "approved-variable-mismatch", name, actual: declarations.map((node) => node.value) });
    }
  }
  // Remove only approved new declarations, then the entire old stylesheet
  // (including every preexisting declaration and its order) must match.
  newRoots[0].nodes = newRoots[0].nodes.filter((node) => !added.includes(node));
  const tree = compareTree(before, after, new Map());
  differences.push(...tree.differences);
  return { equal: differences.length === 0, added: added.map((node) => node.prop), differences };
}
