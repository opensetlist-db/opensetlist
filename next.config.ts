import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl({
  serverExternalPackages: ["kuromoji"],
  // Two tracing gaps break /api/og/* on Vercel, and both surface as the same
  // Next static /500 page at cold start because @vercel/og throws at module
  // load before the route handler's try/catch can run:
  //
  //   1. loadOgFonts() reads three WOFFs via
  //        readFile(path.join(process.cwd(), "node_modules/@fontsource/.../*.woff"))
  //      which the Next file tracer can't resolve from a dynamic path string,
  //      so the font files get dropped from the Vercel function bundle.
  //
  //   2. Turbopack rewrites `@vercel/og` imports to Next's internal compiled
  //      copy at `node_modules/next/dist/compiled/@vercel/og/`, which ships
  //      `resvg.wasm`, `yoga.wasm`, and `Geist-Regular.ttf` alongside the JS.
  //      Those binaries are loaded with a dynamic path the tracer can't
  //      follow, so the function crashes at cold start before the route's
  //      try/catch can run.
  //
  // Include both sets explicitly for every /api/og/* function.
  outputFileTracingIncludes: {
    "/api/og/**": [
      "./node_modules/@fontsource/dm-sans/files/dm-sans-latin-700-normal.woff",
      "./node_modules/@fontsource/noto-sans-kr/files/noto-sans-kr-korean-700-normal.woff",
      "./node_modules/@fontsource/noto-sans-jp/files/noto-sans-jp-japanese-700-normal.woff",
      "./node_modules/next/dist/compiled/@vercel/og/resvg.wasm",
      "./node_modules/next/dist/compiled/@vercel/og/yoga.wasm",
      "./node_modules/next/dist/compiled/@vercel/og/Geist-Regular.ttf",
    ],
  },
});
