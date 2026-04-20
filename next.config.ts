import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl({
  serverExternalPackages: ["kuromoji"],
  // loadOgFonts() reads the three WOFFs via
  //   readFile(path.join(process.cwd(), "node_modules/@fontsource/.../*.woff"))
  // which the Next file tracer can't resolve from a dynamic path string, so
  // the font files get dropped from the Vercel function bundle and every
  // /api/og/* route throws at runtime (both the main render and the bare
  // fallback, surfacing as 404 "Not found"). Explicitly include the three
  // WOFFs we actually load in every /api/og/* function bundle.
  outputFileTracingIncludes: {
    "/api/og/**": [
      "./node_modules/@fontsource/dm-sans/files/dm-sans-latin-700-normal.woff",
      "./node_modules/@fontsource/noto-sans-kr/files/noto-sans-kr-korean-700-normal.woff",
      "./node_modules/@fontsource/noto-sans-jp/files/noto-sans-jp-japanese-700-normal.woff",
    ],
  },
});
