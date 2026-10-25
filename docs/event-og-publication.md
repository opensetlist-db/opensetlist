# Event share-card publication

The operator lifecycle is local preview → exact reviewed packet → explicit
one-mode publication → three versioned locale URLs. Creation remains an
operator CLI operation; there is no public publication endpoint or mode picker.
Existing event links, legacy OG and personal PNGs keep their behavior.

Use Node24 and the checkout's installed dependencies. Preview and replay retain
the commands in [the preview runbook](event-og-preview.md). The new commands
require both DB settings to pass the existing dev-project guard. Publication
also requires the configured R2 namespace to be `dev` or `test`; production
publication is outside this stage. `NEXT_PUBLIC_BASE_URL` is the trusted share
origin and must be an HTTPS origin (HTTP is allowed only on loopback for QA).
R2 image URLs derive exclusively from the deployment's existing R2 config.

## Exact approval and explicit publication

After the owner reviews the actual PNGs, retain the approval outside Git. Make
an envelope naming the exact manifest identity, selected event/mode and three
original PNG hashes, plus the approval record's bytes/hash:

```json
{
  "kind": "owner-reviewed-event-card",
  "eventId": "109",
  "mode": "prediction",
  "previewId": "manifest-previewId",
  "outputs": { "ja": "png-sha256", "ko": "png-sha256", "en": "png-sha256" },
  "evidenceFile": "/operator-only/owner-approval.md",
  "evidenceSha256": "sha256-of-exact-approval-file-bytes"
}
```

This is an operator evidence contract, not authentication of who authored a
file. An arbitrary `approved:true` does not satisfy it. Do not expose this CLI
or its files as an untrusted-user API. Preserve the envelope and evidence bytes
at their recorded locations for retries; relocation is not the same envelope.
The database stores approval identity digests, never private evidence paths.

```powershell
node scripts/event-og.mjs publish --event 109 --mode prediction --revision <new-UUID> --manifest <packet>/manifest.json --approval <approval.json>
node scripts/event-og.mjs list --event 109
```

The service checks all output hashes and the complete locale set, current
relevant event/series/artist facts, original/display titles, fonts, renderer and
template identity. It re-renders the packet in a temporary local directory and
requires the same identity before uploading the exact reviewed original bytes.
Source facts are checked again in the publication transaction. Slug changes
affect navigation only; event status, engagement, metrics and the clock are not
publication triggers or approval invalidators.

All three immutable writes precede ONE serializable transaction creating the
aggregate, its locale content and ImageAsset references. A failed second/third
upload or a rolled-back transaction exposes no partial publication. Uploaded
but unassigned objects can remain; nothing deletes them automatically.

Keep the same UUID/envelope/bytes when retrying. A committed matching request
returns the original URLs without re-uploading (including after a future public
suspension). Reusing that UUID for different content or tuples is a conflict.
A lost COMMIT reply is reconciled by a fresh committed fingerprint lookup. If
that lookup cannot establish the outcome, the CLI exits unsuccessfully with
`outcome_unknown`; use the same request again, never invent a success or a new
revision. Known pre-commit errors report `not_saved`.

## Public reads and immutable content

`/{locale}/share/events/{eventId}/{mode}/{revision}` is a wrapper identity, not
the Event canonical. It returns complete metadata-bearing 200 HTML for normal
visitors and social crawlers alike. A Route Handler renders the full head, so
navigation cannot race Next's streamed metadata and no global bot setting
changes. Stored titles/descriptions/images are frozen; current messages and
Event names do not reconstruct historical OG. Official full names remain in
the HTML even when a card display title was used.

The static navigation script follows only a validated, same-origin canonical
event path, replaces history, and adds no query/tab/hash. With JavaScript off
or navigation blocked, the visible localized link remains accessible. Share
HTML uses no-store/noindex-follow; immutable PNG caching stays in R2. Missing,
mismatched, unpublished or deleted-event tuples return404. Infrastructure
failure returns non-cacheable503 with Retry-After, without poisoning a successful
version URL with a fallback card. Share wrappers are not added to sitemap or
blocked from social crawlers in robots.

Frozen publication/rendition payloads and mutable annotations are separate
tables. Correction and public-suspension operations are subsequent work. A
non-active annotation is not served as an ordinary auto-navigating card here.
Public readers project neither approval data nor ImageAsset provenance.

## Validation

```powershell
npx vitest run src/__tests__/unit/event-og-publication.test.ts src/__tests__/unit/event-og-preview.test.ts
npx vitest run -c vitest.integration.config.ts src/__tests__/integration/event-og-publication.test.ts
# Run a production build/start at the matching local origin first.
$env:EVENT_CARD_R2_E2E='1'; $env:R2_KEY_PREFIX='test'; $env:TEST_BASE_URL='http://127.0.0.1:3192'
$env:NEXT_PUBLIC_BASE_URL='http://127.0.0.1:3192'
npx playwright test tests/e2e/event-og-publication.spec.ts
```

Integration uses real dev DB plus MemoryImageStorage and cleans its fixed
`og02itest-` fixture prefix. The E2E is explicitly gated: it requires the dev
bucket, writes nine synthetic PNGs under `test/event-cards/`, and retains those
objects. Its helper records exact keys BEFORE writes. DB fixtures under
`og02e2e-` are purged and cleaned; evidence, HTML, screenshots and object keys
remain in the printed local output folder. No production data or existing
images are mutated. A skipped opt-in suite is not a passing transport result.

Before production rollout, prove precise origin/CDN revocation permissions and
behavior in the public-suspension work. Immutable R2 writes alone do not stop
public delivery. Deployed public URL and actual X unfurl evidence remain
separate from local Twitterbot HTTP; do not post automatically.
