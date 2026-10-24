# Shared font proof

Run the production build separately, then supply the approved font manifest
explicitly. The manifest is external evidence; it is never copied into this
repository or discovered from a machine-specific path.

```sh
node scripts/font-proof.mjs --base http://localhost:3121 --manifest /path/to/approved/font-manifest.json --out .claude/tmp/font-proof --smoke
```

This checks **ko / privacy / 390px**, normal → cold → failure, in fresh browser
contexts. A failed assertion, exception or timeout stops the small run. Without
`--smoke`, the same preflight must pass before the full 13 page × 3 locale ×
2 width × 3 state matrix (234 cells) starts. `--quick` limits the subsequent
matrix to ko / 390px; `--browser webkit` uses the existing harness's WebKit
support. Both options still run all three preflight states. Results live in
separate `smoke/` and `matrix/` directories. Use a new output directory per run
to preserve earlier failures.

The existing `page-qa.mjs --scenario shared-foundation` entry point remains
available for compatibility. It records response hashes but does **not** claim
approved-manifest validation. Use `font-proof.mjs` for that assertion.

The external manifest format is a nonempty JSON array of `{ "file":
"font.woff2", "sha256": "<64 lowercase hex characters>" }` records, as used
by approved font packets. Other metadata is allowed. Next build filenames are
hashed, so comparison uses exact response-body SHA membership in the approved
set, rather than URL basename. The report records the manifest file's SHA256.
Every observed response must be approved and successful. Normal and released
cold cells require responses; a deliberately aborted failure cell may have
none. A manifest match proves approved bytes were delivered, while CDP checks
prove the specimen actually painted the requested custom faces and weights.

`scripts/page-qa/font-proof.mjs` owns exact specimen coverage, glyph counts,
static PostScript weight suffixes, cold/failure faces, painted system fallback,
request failure classification, immediate response rejection handling and
manifest comparison. The scenario continues to own browser timing, interception,
roles, screenshots and matrix traversal. Only an explicit
`next-router-prefetch: 1` request **and** cancellation qualifies for the Next
prefetch exception. Ordinary API failures and page exceptions remain failures.

The shared checks run in the existing database-free unit CI:

```sh
npx vitest run src/__tests__/unit/font-proof.test.ts
```

An additional local HTTP experiment serves installed Fontsource assets on an
ephemeral loopback port. It runs the actual three-state scenario without React
hydration, checks a deliberately wrong weight, and tests real browser request
failures (ordinary cancellation, explicit prefetch cancellation, failed
prefetch), plus a font HTTP 503. It writes its original PASS and expected FAIL
reports separately and closes only its own browser and server:

```sh
node scripts/font-proof-browser-check.mjs --manifest /path/to/approved/font-manifest.json --out .claude/tmp/font-proof-controls
```

These fixtures are detector evidence, not application screenshots. The small
preflight and local experiment do not replace the complete application matrix,
performance evidence, consumer-specific QA or mandatory actual iOS checks.
WebKit's lack of CDP is retained as an explicit skip, never an actual iOS pass.
The visual-readiness tooling in `scripts/capture/visual-ready.mjs` (on `dev`)
is for ordinary capture; it intentionally is not invoked while cold responses
are gated or fonts are deliberately failed.
