// CSS lint (`npm run lint:css`, run by `npm run lint`). One rule: CSS
// modules take colours from the palette custom properties, not hex
// literals — the same guardrail ESLint's `no-restricted-syntax` gives
// TS/TSX (eslint-rules/hex-colour-literals.mjs), which never sees .css.
// A warning like its ESLint twin, so existing literals do not fail CI.
//
// src/app/globals.css is out of scope: its `:root` block is where the
// palette's hex values are defined.
/** @type {import("stylelint").Config} */
const config = {
  rules: {
    "color-no-hex": [true, { severity: "warning" }],
  },
  ignoreFiles: ["src/app/globals.css"],
};

export default config;
