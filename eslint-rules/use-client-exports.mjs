/**
 * `local/use-client-exports` — a module whose first statement is the
 * "use client" directive may export only React components (PascalCase
 * with at least one lowercase letter) and hooks (`useX`). Type-only
 * exports and default exports are allowed. A component-shaped name
 * bound to a plain value (literal, template, object, array) is still a
 * value and is reported.
 *
 * Why: a server component that imports from a "use client" module gets
 * a client reference, not the value — an exported constant or helper
 * can come through as `undefined` at SSR. Shared values and helpers
 * belong in a plain module (e.g. `src/lib/board/config.ts`,
 * `src/lib/board/pickTitle.ts`) that both sides import. This used to
 * be a remembered convention; it slipped through review twice, so it
 * is a lint error now.
 *
 * `export * from` in a client module is refused outright: the names it
 * re-exports can't be checked here.
 */

const COMPONENT = /^[A-Z](?=.*[a-z])[A-Za-z0-9]*$/;
const HOOK = /^use[A-Z0-9]/;

function allowed(name) {
  return COMPONENT.test(name) || HOOK.test(name);
}

/** An initializer that is plainly a value, never a component or hook:
 *  a literal (incl. `-1`), template, object or array. The name alone
 *  can't tell — `export const BoardLimit = 3` is PascalCase. Calls
 *  (`memo(...)`, `forwardRef(...)`, `createContext(...)`) and functions
 *  pass: they are how components and hooks are written. */
function isPlainValue(init) {
  if (!init) return false;
  switch (init.type) {
    case "Literal":
    case "TemplateLiteral":
    case "ObjectExpression":
    case "ArrayExpression":
      return true;
    case "UnaryExpression":
      return isPlainValue(init.argument);
    case "TSAsExpression":
    case "TSSatisfiesExpression":
      return isPlainValue(init.expression);
    default:
      return false;
  }
}

function isClientModule(program) {
  const first = program.body[0];
  return (
    first?.type === "ExpressionStatement" &&
    first.directive === "use client"
  );
}

/** Binding names introduced by a declarator pattern (`a`, `{ a }`,
 *  `[a]`, `{ a: { b } }`, `...rest`). */
function patternNames(node, out = []) {
  if (!node) return out;
  switch (node.type) {
    case "Identifier":
      out.push(node.name);
      break;
    case "ObjectPattern":
      for (const p of node.properties) {
        patternNames(p.type === "RestElement" ? p.argument : p.value, out);
      }
      break;
    case "ArrayPattern":
      for (const el of node.elements) patternNames(el, out);
      break;
    case "RestElement":
      patternNames(node.argument, out);
      break;
    case "AssignmentPattern":
      patternNames(node.left, out);
      break;
  }
  return out;
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        'Only components and hooks may be exported from a "use client" module',
    },
    schema: [],
    messages: {
      nonComponent:
        '"{{name}}" is exported from a "use client" module. Export only components and hooks here; move shared values and helpers to a plain module that both server and client import.',
      exportAll:
        '`export *` from a "use client" module can\'t be checked; export the components and hooks by name.',
    },
  },
  create(context) {
    let client = false;
    const report = (node, name) =>
      context.report({ node, messageId: "nonComponent", data: { name } });

    return {
      Program(node) {
        client = isClientModule(node);
      },
      ExportAllDeclaration(node) {
        if (client && node.exportKind !== "type") {
          context.report({ node, messageId: "exportAll" });
        }
      },
      ExportNamedDeclaration(node) {
        if (!client || node.exportKind === "type") return;
        const decl = node.declaration;
        if (decl) {
          switch (decl.type) {
            case "TSTypeAliasDeclaration":
            case "TSInterfaceDeclaration":
              return;
            case "FunctionDeclaration":
              if (decl.id && !allowed(decl.id.name)) report(decl, decl.id.name);
              return;
            // Classes and enums are runtime values, never components here.
            case "ClassDeclaration":
            case "TSEnumDeclaration":
              if (decl.id) report(decl, decl.id.name);
              return;
            case "VariableDeclaration":
              for (const d of decl.declarations) {
                const plain = d.id.type === "Identifier" && isPlainValue(d.init);
                for (const name of patternNames(d.id)) {
                  if (plain || !allowed(name)) report(d, name);
                }
              }
              return;
            default:
              return;
          }
        }
        for (const spec of node.specifiers) {
          if (spec.exportKind === "type") continue;
          const name =
            spec.exported.type === "Identifier"
              ? spec.exported.name
              : spec.exported.value;
          if (name === "default") continue;
          if (!allowed(name)) report(spec, name);
        }
      },
    };
  },
};
