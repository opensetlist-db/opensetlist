import { withSentryConfig } from "@sentry/nextjs";
import createNextIntlPlugin from "next-intl/plugin";
import { OG_FONTS } from "./src/lib/ogFonts";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Source-map upload and release creation run only on CI and Vercel builds.
// The local `.env` carries SENTRY_AUTH_TOKEN, so without this gate every
// local `next build` (perf baselines, redesign QA) silently uploads source
// maps and creates or touches a release named after the local git SHA —
// noise in the Sentry project that is indistinguishable from a deployed
// build.
// Vercel sets VERCEL=1 and GitHub Actions sets CI=true during builds, so
// deployed bundles keep their source maps. Only the build plugin is gated:
// the runtime SDK, DSN and /monitoring tunnel behave the same everywhere.
// To upload from a local build on purpose, run it with CI=1.
const uploadToSentry = Boolean(process.env.CI || process.env.VERCEL);

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
  //
  // Same shape of issue for kuroshiro: KuromojiAnalyzer reads its dictionary
  // from `node_modules/kuromoji/dict/*.dat.gz` via a runtime path that the
  // tracer can't see (`serverExternalPackages: ["kuromoji"]` covers the JS
  // module but not the data files). Without the dict files, kuroshiro
  // init throws at runtime and the deriveSlug helper falls back to "" /
  // timestamp slugs.
  //
  // Every admin POST route that auto-derives a slug now flows through
  // deriveSlug (Scope B refactor — see src/lib/slug.ts), so each one
  // gets the dict alongside its function bundle. ~17MB compressed per
  // matching function; explicit per-route entries instead of an umbrella
  // /api/admin/** so routes that don't transliterate (impressions
  // moderation, CSV import, translation debug, etc.) don't pay the
  // bundle-size cost. The artists entry covers
  // /api/admin/artists/[id]/stage-identities/** automatically since
  // it's a subtree.
  outputFileTracingIncludes: {
    "/api/og/**": [
      ...OG_FONTS.map(({ file }) => `./node_modules/${file}`),
      "./node_modules/next/dist/compiled/@vercel/og/index.node.js",
      "./node_modules/next/dist/compiled/@vercel/og/package.json",
      "./node_modules/next/dist/compiled/@vercel/og/resvg.wasm",
      "./node_modules/next/dist/compiled/@vercel/og/yoga.wasm",
      "./node_modules/next/dist/compiled/@vercel/og/Geist-Regular.ttf",
    ],
    "/api/admin/songs/**": ["./node_modules/kuromoji/dict/*.dat.gz"],
    "/api/admin/slug-generator/**": ["./node_modules/kuromoji/dict/*.dat.gz"],
    "/api/admin/artists/**": ["./node_modules/kuromoji/dict/*.dat.gz"],
    "/api/admin/events/**": ["./node_modules/kuromoji/dict/*.dat.gz"],
    "/api/admin/event-series/**": ["./node_modules/kuromoji/dict/*.dat.gz"],
  },
}), {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "opensetlist",

  project: "opensetlist",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // See `uploadToSentry` above. The empty token is what actually stops the
  // plugin from talking to Sentry: it falls back to SENTRY_AUTH_TOKEN only
  // when `authToken` is undefined (`??`), and every API step (release
  // create, set-commits, upload) returns early without a token.
  // `release.create: false` alone is not enough — the SDK then drops the
  // release options, and the plugin core still derives a release from the
  // git SHA and runs `set-commits` on it. `sourcemaps.disable` additionally
  // skips source-map generation and debug-ID injection locally.
  authToken: uploadToSentry ? process.env.SENTRY_AUTH_TOKEN : "",
  sourcemaps: { disable: !uploadToSentry },

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
