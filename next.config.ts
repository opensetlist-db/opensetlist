import { withSentryConfig } from "@sentry/nextjs";
import createNextIntlPlugin from "next-intl/plugin";
import { OG_FONTS } from "./src/lib/ogFonts";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withSentryConfig(withNextIntl({
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
      ...OG_FONTS.map(({ file }) => `./node_modules/${file}`),
      "./node_modules/next/dist/compiled/@vercel/og/index.node.js",
      "./node_modules/next/dist/compiled/@vercel/og/package.json",
      "./node_modules/next/dist/compiled/@vercel/og/resvg.wasm",
      "./node_modules/next/dist/compiled/@vercel/og/yoga.wasm",
      "./node_modules/next/dist/compiled/@vercel/og/Geist-Regular.ttf",
    ],
  },
}), {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "opensetlist",

  project: "opensetlist",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: "/monitoring",

  webpack: {
    // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
    // See the following for more information:
    // https://docs.sentry.io/product/crons/
    // https://vercel.com/docs/cron-jobs
    automaticVercelMonitors: true,

    // Tree-shaking options for reducing bundle size
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },
  },
});
