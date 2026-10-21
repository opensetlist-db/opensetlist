/**
 * `local/img-onerror-ref` — in a "use client" module, a JSX `<img>` with an
 * `onError` handler also has a `ref`.
 *
 * A client component is still server-rendered: the `<img>` arrives in the
 * HTML and the browser starts loading it before React hydrates. If the
 * load fails in that window, the `error` event fires on an element React
 * has not attached its listener to yet, and React's `onError` never runs
 * — the failure UI (a placeholder, a "could not load" note) never
 * appears, and the page shows a broken image instead. Code review rarely
 * catches it: the handler reads as complete, and only a browser that
 * loads a broken URL before hydration shows the gap.
 *
 * The fix is a mount-time check in a callback ref, which runs when React
 * attaches to the element during hydration:
 *
 *   <img
 *     src={src}
 *     onError={() => setFailed(true)}
 *     ref={(el) => {
 *       if (el && el.complete && el.naturalWidth === 0) setFailed(true);
 *     }}
 *   />
 *
 * `complete && naturalWidth === 0` is a load that already finished
 * without an image (a failed one); a still-loading image has
 * `complete === false` and is left to `onError`.
 *
 * The rule asks only that a `ref` is there, not what it does — the check
 * can also live in a hook (`ref={imgRef}` plus a `useEffect`). It skips an
 * `<img>` with a spread attribute (`{...props}`), which may carry the ref.
 * Modules without "use client" as their first statement are skipped.
 * Rendered as a server component, such a module cannot pass an event
 * handler at all; but a directive-less module imported from a client one
 * is client code too, and its `<img onError>` goes unchecked — the rule
 * cannot see the import graph. `next/image` (`<Image>`) is not covered.
 */

function isClientModule(program) {
  const first = program.body[0];
  return (
    first?.type === "ExpressionStatement" &&
    first.directive === "use client"
  );
}

function hasAttribute(attributes, name) {
  return attributes.some(
    (attr) =>
      attr.type === "JSXAttribute" &&
      attr.name.type === "JSXIdentifier" &&
      attr.name.name === name,
  );
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require a ref on an <img> with onError in a client component, so a load that fails before hydration is still caught",
    },
    schema: [],
    messages: {
      missingRef:
        "<img onError> needs a ref that checks the image on mount (e.g. `el.complete && el.naturalWidth === 0`): a server-rendered image that fails before hydration never fires React's onError.",
    },
  },
  create(context) {
    let client = false;
    return {
      Program(program) {
        client = isClientModule(program);
      },
      JSXOpeningElement(node) {
        if (!client) return;
        if (node.name.type !== "JSXIdentifier" || node.name.name !== "img") {
          return;
        }
        const attrs = node.attributes;
        if (!hasAttribute(attrs, "onError")) return;
        if (hasAttribute(attrs, "ref")) return;
        if (attrs.some((attr) => attr.type === "JSXSpreadAttribute")) return;
        context.report({ node, messageId: "missingRef" });
      },
    };
  },
};

export default rule;
