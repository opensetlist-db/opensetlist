# Event share-card previews

Requires Node 24 and the checkout's installed dependencies. This operator-only
CLI reads **dev** data through `db-ro.mjs` (`BEGIN READ ONLY` / rollback), then
renders local PNGs. It has no publication model, storage writer or share URL.
Existing dynamic OG and personal prediction/score PNG sharing are unchanged.

```powershell
# Optional: serve a production build locally to capture the existing OG.
# Build with Sentry upload variables empty, as described in TESTING.md.
node node_modules/next/dist/bin/next start -p 3191

# Run in a separate terminal. Parent directory must exist; output must be new.
node scripts/event-og.mjs preview --events 109,7 --out <new-local-directory> --legacy-base http://127.0.0.1:3191

# Offline reproduction verifies the complete input packet, every image hash,
# and the newly rendered identity. Changed source/fonts/runtime stop replay.
node scripts/event-og.mjs replay --manifest <packet>/manifest.json --out <another-new-directory>
```

Omit `--legacy-base` when no local server is running. Comparisons use the
existing route pinned to `s=completed` for a stable baseline; that archival
label is not a claim about the event's present status. Baseline network access
is limited to loopback origins. The selected events must be real, non-deleted
dev Event records; the command never substitutes another event or a fallback.

Each event produces nine 1200×630 originals, nine 600×315 versions, nine
360×189 mobile thumbnails, and three mode comparisons. With the baseline it
also includes three existing OG PNGs and three old/new comparisons. Open
`index.html` locally to review all images; no web deployment is needed.

The manifest records source facts, strict locale/original fallbacks, effective
displayed text, official event/series titles, measured text sizes/line counts,
template parameters/source hashes, the actual site-symbol hash, all bundled
font hashes, renderer/runtime/lockfile identity, output dimensions and SHA-256s.
`previewId` hashes that complete payload. Generation is deterministic within
the recorded environment; a different Node/renderer/lockfile is a new preview.
The gallery is a convenience; the manifest binds the images.

The title is the complete localized series name where present, with the
complete event name as the performance designation. Without a series the full
event name is the title. Artist context is omitted when already included in
either name. Venue and date are omitted when absent; no Day label is invented.

The shared light template uses the existing ImageResponse/Satori stack and OG
WOFF list, plus the site's Josefin wordmark. Satori measures actual font paths
with no line clamp or ellipsis. Title limits are 40–60px / four lines, with
34px date, 30px purpose, 28–32px performance and 28px venue. At 360px the title
is at least 12px. All nine purpose strings live in the message catalogs.
Missing font files, unsupported glyphs, overflow or excess shrinking fail the
command. Every render finishes before the new output directory is created;
an I/O failure during writing may leave an incomplete directory without a
valid manifest. Preserve it for diagnosis and choose a new output directory.

## Display-title review

First run without an override. Only a full-title **layout** failure permits a
display title. Glyph/font failure and overflowing performance/venue never do.
The error identifies the failing full title and readability budget. Present
the operator with a proposed shorter title based only on the same facts and
preserve the original name. Do not infer approval from ticket-scope approval.

After explicit operator approval, save that approval (including exact event,
locale and chosen title) outside the repository and pass a JSON array via
`--display-titles <file>`:

```json
[
  {
    "eventId": "123",
    "locale": "ja",
    "title": "Operator-approved display title",
    "reviewFile": "/absolute/path/to/approval.txt",
    "reviewSha256": "sha256-of-the-exact-approval-file-bytes"
  }
]
```

The service checks the evidence bytes and rejects duplicate/wrong event or
locale entries, changed evidence, and overrides of titles that already fit.
It preserves official names and the full-title failure in the manifest. The
file hash records evidence identity; it cannot authenticate who approved it.
An arbitrary `approved: true` flag is not an approval credential. These local
review paths must not be copied into public metadata by a later publisher.

## Handoff to publication

A generated packet remains `pending-owner-visual-review`. Record the owner's
actual approval of **that previewId and output hashes**, including any edits.
Generation and offline replay never approve or publish it. Later publication
must recheck current relevant source facts, fonts/template and all output
hashes, and publish one chosen mode's complete ja/ko/en group atomically.
The current `readPreview` checks packet integrity, not operator authority or
fresh DB content. Storage, immutable publications, share pages, corrections,
suspension and deployed/X verification belong to subsequent work.
