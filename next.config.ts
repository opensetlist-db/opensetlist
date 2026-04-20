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
  //   2. @vercel/og ships `resvg.wasm`, `yoga.wasm`, and `Geist-Regular.ttf`
  //      inside its own dist/ dir and loads them at import time with a similar
  //      dynamic path. Those three files are not traced either, so the function
  //      crashes before the route code runs.
  //
  // Include both sets explicitly for every /api/og/* function.
  outputFileTracingIncludes: {
    "/api/og/**": [
      "./node_modules/@fontsource/dm-sans/files/dm-sans-latin-700-normal.woff",
      "./node_modules/@fontsource/noto-sans-kr/files/noto-sans-kr-korean-700-normal.woff",
      "./node_modules/@fontsource/noto-sans-jp/files/noto-sans-jp-japanese-700-normal.woff",
      "./node_modules/@vercel/og/dist/resvg.wasm",
      "./node_modules/@vercel/og/dist/yoga.wasm",
      "./node_modules/@vercel/og/dist/Geist-Regular.ttf",
    ],
  },
});
