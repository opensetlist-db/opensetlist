// CSS lint (`npm run lint:css`, run by `npm run lint`). One rule: CSS
// modules take colours from the palette custom properties, not hex
// literals — the same guardrail ESLint's `no-restricted-syntax` gives
// TS/TSX (eslint-rules/hex-colour-literals.mjs), which never sees .css.
// Legacy modules warn like the ESLint twin. Palette-only modules fail
// on new hex literals so they cannot silently undo the token migration.
//
// src/app/globals.css is out of scope: its `:root` block is where the
// palette's hex values are defined.
/** @type {import("stylelint").Config} */
const config = {
  rules: {
    "color-no-hex": [true, { severity: "warning" }],
  },
  overrides: [
    {
      files: [
        "src/components/albums/albumList.module.css",
        "src/components/artists/artistDetail.module.css",
        "src/components/artists/artistList.module.css",
        "src/components/event/eventDetail.module.css",
        "src/components/home/home.module.css",
        "src/components/legal/legal.module.css",
        "src/components/members/memberDetail.module.css",
        "src/components/search/search.module.css",
        "src/components/albums/detail/albumDetail.module.css",
        "src/components/series/detail/seriesDetail.module.css",
        "src/components/songs/detail/songDetail.module.css",
      ],
      rules: {
        "color-no-hex": [true, { severity: "error" }],
      },
    },
  ],
  ignoreFiles: ["src/app/globals.css"],
};

export default config;
