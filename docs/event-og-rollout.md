# Event share-card rollout

Initial production publication is limited to the owner's two confirmed Fes2
performances. Preparing previews, integrating code, releasing it, publishing a
mode and verifying X are distinct steps. None implies another's approval.

## Integration and release order

1. Use the current `feature/event-og-renewal` plus current `dev`, preserve all
   unrelated releases, and run the lifecycle/legacy sharing checks below on its
   actual immutable Preview URL. Record the deployment SHA, not just a branch
   alias. Confirm01–04 evidence and actual owned origin/cache revocation.
2. After integration QA and the outstanding delivery verification, prepare the
   single renewal→dev PR for the owner. Every PR merge belongs to the owner.
3. Follow the existing release procedure: backup, additive-only production
   migration/verification BEFORE the owner dev→main merge, then wait for the
   exact main SHA's successful Vercel Production deployment and create the
   annotated version/release record. Do not permit unrelated DROP statements.
4. Generate production-data previews through the hosted read-only operation.
   Review the actual output. Publish only the explicitly selected mode for one
   performance, with its three locales together. The second performance needs
   its own explicit selection. No automatic time/status/all-mode publication.
5. Check the published public URLs and actual X previews. Missing X evidence
   keeps rollout incomplete and prevents expansion outside Fes2. Do not post
   to SNS without a separate explicit instruction.

The current dev image endpoint is uncached r2.dev. Successful exact-origin
deletion there and independent simulated-cache tests do **not** satisfy live
custom-domain CDN verification. Code integration does not erase that gap.

## Hosted production configuration

The existing `scripts/event-og.mjs` remains dev-only. Do not pull production DB
credentials into a local checkout. `.github/workflows/event-card-ops.yml` is a
manual hosted path for preview, publish, list, recovery inspection, correction and public suspension.
It cannot run until the owner releases that workflow to main. It requires:

- `workflow_dispatch` on main, the known repository/workflow, GitHub-hosted
  runner, and original AND rerun actor `helloopensetlistdb`.
- Actual Vercel-bot Production deployment/status evidence for the exact running
  main SHA. The integration reports `production_environment:false` even for
  its real Production environment, so that boolean is not the authority.
- Both DB settings supplied by `PROD_DATABASE_URL_UNPOOLED`, matching the
  separately configured production project and session port5432. Read-only
  preview/list/inspection queries run inside `SET TRANSACTION READ ONLY` transactions.
- An exact two-item Fes2 ID/slug inventory. These are owner-confirmed production
  records, not assumed copies of development IDs or mockup examples.

Before adding any new secret, the owner must configure the dedicated GitHub
`EventCardProduction` environment: custom deployment-branch policies enabled,
protected-branches mode disabled, and exactly one **branch** policy, `main`.
The operation checks this configuration through the read-only Actions API.
An in-file `if:` alone cannot protect secrets from a different branch's workflow.
Do not change the existing `Production` environment: release migrations use it
before the dev→main merge. Its existing repository-level production DB secret
still has the repository's inherited access model; this workflow does not claim
to isolate that legacy secret from other repository workflows. Moving that
secret requires a separate review of the existing release procedure.

Only the owned verify/execute steps receive production secrets. `npm ci`,
checkout and artifact actions receive none; Prisma generation during installation
uses a dummy localhost URL. Adding credentials or changing environment protection
is an owner configuration step; starting this ticket does not authorize it.

Configure these **variables** in EventCardProduction after
confirming the actual values; never send secret values in chat:

| Variable | Purpose |
| --- | --- |
| `EVENT_CARD_PROD_PROJECT_REF` | Exact production Supabase project ref; dev is refused |
| `EVENT_CARD_FES2_TARGETS` | JSON array of exactly two `{ "id":"…", "slug":"…" }` production targets |
| `EVENT_CARD_PROD_BUCKET` | Confirmed production R2 bucket, never the dev bucket |
| `EVENT_CARD_PUBLICATION_ENABLED` | Leave absent until delivery validation; explicitly set `reviewed-delivery-paths` after owner signoff |
| `EVENT_CARD_DELIVERY_PROOF_SHA256` | Digest of the retained owner-reviewed live origin/CDN report; a configured digest is an attestation, not automated proof that tests ran |
| `EVENT_CARD_DELIVERY_BASES` | Complete active production HTTPS alias inventory, including `https://img.opensetlist.com` |
| `CLOUDFLARE_CACHE_ZONE_ID`, `CLOUDFLARE_CACHE_ZONE_HOST` | Exact cache zone/path scope for suspension |

Secret **names** required for production writes: `R2_ACCOUNT_ID`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `CLOUDFLARE_CACHE_PURGE_TOKEN`
(the latter for suspension). Existing repository secret
`PROD_DATABASE_URL_UNPOOLED` supplies the DB. Correction/suspension additionally
read `EVENT_CARD_PRIVATE_REASON` from the dedicated environment secret; do not put a
private reason in public dispatch JSON. The list artifact deliberately omits
private reasons, audit internals and approval paths. R2 namespace is `prod` and
the trusted public image base is fixed to `https://img.opensetlist.com`.

Preview/publish also require `EVENT_CARD_PREVIEW_ENCRYPTION_KEY`, a privately
generated 32-byte key encoded as 64 lowercase hex characters. Keep a recoverable
owner-only copy outside Git and chat. This AES-256-GCM key encrypts draft packets
before upload: artifacts of this public repository are downloadable by other
GitHub users. Only authenticated ciphertext and a hash/identity summary are
uploaded. Plain PNGs, source snapshots and selection evidence stay in ephemeral
runner temp storage. Publish decrypts the original packet without changing its
evidence paths/bytes. Other operations upload only explicit public-safe results.
Key rotation requires a fresh preview or the retained old key for old packets;
it must not block list/inspection/correction/emergency suspension.

At implementation time only the two DEV/PROD DB secret names existed; prod R2,
purge permissions and these rollout variables were not configured or tested.
The agent did not retrieve their values, create credentials or run production
operations. A passing policy unit test is not a hosted execution result.

## Preview, exact approval and publication

Prepare a request JSON outside Git. In the examples below replace IDs/slugs
with confirmed production records; no development ID is a production claim.

```json
{"eventIds":["<Fes2-Day1-ID>","<Fes2-Day2-ID>"]}
```

The owner dispatches `event-card-ops.yml` on main with `operation=preview`,
`request=<that exact JSON>` and `confirm=READ-ONLY`. This is a read-only DB
snapshot and local renderer operation in the hosted runner: no publication
rows, PUTs or public draft URLs. Download artifact
`event-card-preview-<run-id>-<run-attempt>`. With the private key supplied through
the local process environment, decrypt offline into a **new private directory**:

```powershell
node scripts/event-og-preview-decrypt.mjs --in '<download>/preview.enc' --out '<private-parent>/fes2-preview'
```

The parent must exist. Never put the key in command arguments, upload plaintext
to GitHub or use the application's `public/` directory (the CLI refuses it).
Inspect `packet/index.html`,18 originals, half/mobile/mode comparisons, manifest,
source records, fonts and glyphs. Record the exact `manifestSha256` from the
decrypted `operation-result.json` and compare the downloaded `summary.json`.

If the official full title fails measured layout, an owner-selected
`displayTitles` array may accompany a new preview request:
`[{"eventId":"…","locale":"ja","title":"…"}]`. The dispatch's exact
owner selection becomes evidence; title overrides still apply only after the
full official title fails. Preserve the original title in the source snapshot.
Review the resulting packet again. Do not inherit development approval for a
changed production card.

For one reviewed performance and one explicitly selected mode, the owner then
dispatches `operation=publish` with:

```json
{"eventId":"<confirmed-ID>","mode":"prediction","revision":"<retained-new-UUID>"}
```

Supply `confirm=APPROVE-FES2-CARD`, the successful preview's `preview_run_id`,
exact `preview_run_attempt`
and exact `approved_manifest_sha256`. The workflow verifies the preview run's
repository/workflow, owner, success and SAME deployed main SHA for that exact
attempt before download. Upload names include run ID AND attempt, retaining
earlier evidence without v4 artifact-name collisions on GitHub Re-run.
The service checks manifest/output hashes, renderer/fonts and current source
facts, then atomically publishes three locales. No arbitrary key/URL target or
implicit mode is accepted. Output `operation-result.json` records the exact
version/locale URLs. Retain the selected image hashes from the approved packet.

If main changed since preview, create/review a fresh preview. Restore artifacts
to the original hosted temp path so display-title review evidence retains its
identity. Do not rewrite manifest paths/hashes to make a relocated packet pass.

For an uncertain publication, retry the **same** preview run/attempt, manifest hash,
event, mode and revision. Approval bytes exclude the current attempt time/run
and remain stable across retries. Per-run attempt evidence is separate. Never
allocate another UUID merely because the COMMIT reply was lost.

If main moved or the original preview/key is unavailable, use `operation=inspect`,
`confirm=READ-ONLY`, with the **original** event/mode/revision tuple. This operation
does not require the old preview, its key, R2 credentials or the publication flag.
It reads under the lifecycle lock, without rendering or PUTs, and reports:

- `committed`: compare all three stored hashes/preview/approval digests against
  the original retained evidence. Record the **current annotation status/version**;
  committed/reconciled does not imply active. Never re-upload suspended images.
- `uncertain`: an unsettled writer still exists. Retain the original UUID and
  investigate through the authorized remote path. Do not force-clear it.
- `absent`: only a point-in-time observation. First prove all original workflow
  attempts are terminal and no original process/request can still write. If
  absence remains confirmed, create/review a fresh packet on current main and
  explicitly select a new UUID. Retain any unassigned objects and both records.

If any evidence is unavailable or scope conflicts, stop publication and retain
the uncertainty. Do not invent a successful reconciliation. API/DB errors fail
the operation rather than reporting absence.

## List, correction and suspension

`operation=list`, `confirm=READ-ONLY`, `request={"eventId":"…"}` returns a
public-safe projection of identities/URLs and annotation status/version. Inspect
server-only audit tables through an authorized remote operator path when a
private investigation is necessary; do not export full reasons to artifacts.

For an ordinary correction first preview and explicitly publish a fresh version
B using the same procedure. Then `operation=correct` with an exact request:

```json
{"eventId":"…","mode":"prediction","revision":"<A-UUID>","replacementId":"<B-UUID>","expectedVersion":0,"operationId":"<retained-operation-UUID>"}
```

Use `confirm=APPROVE-FES2-CARD` and the private reason secret. The shared
lifecycle service validates scope, version, chain and immutable history.
For serious incorrect/rights-sensitive content use `operation=suspend` with
the same tuple/version/operation fields but no replacement. Keep one exact
request and private reason for retries. Never include private reasons in
dispatch inputs. Clear/rotate the secret only after the operation is known and
its retry evidence has been retained through the owner's private process.

The safe notice commits before exact origin/cache revocation. `partial` exits1
and retains per-path outcomes; `outcome_unknown` is not a success. Follow
[the suspension runbook](event-og-suspension.md), including uncertain writers
that remain partial indefinitely and the absence of an automatic force-clear.
No real production card is suspended for demonstration; use dev synthetic
combination evidence when no actual correction/suspension is needed.

Disabling `EVENT_CARD_PUBLICATION_ENABLED` stops new publication only. Correction,
suspension and read-only recovery remain available. Missing/wrong delivery
configuration is checked **after** the safe suspension notice and produces
`partial`; it must not prevent removing incorrect content from the wrapper.
Dispatch one operation at a time and confirm its run actually executed. GitHub
concurrency keeps one running and one pending run; a newer dispatch can cancel
an older pending run even with `cancel-in-progress:false`. Cancelled is not pass.

## Public integration verification

Use the immutable deployment URL reported for the exact commit, not a moving
branch alias. Production remains behind the above owner release/approval gates.
The dev-only opt-in matrix is:

```powershell
$env:TEST_BASE_URL='<verified immutable Preview URL>'
$env:NEXT_PUBLIC_BASE_URL=$env:TEST_BASE_URL
$env:EVENT_CARD_R2_E2E='1'; $env:R2_KEY_PREFIX='test'
npx playwright test tests/e2e/event-og-rollout.spec.ts
$env:EVENT_CARD_REGRESSION_E2E='1'
npx playwright test tests/e2e/event-og-regression.spec.ts
```

The lifecycle suite creates12 new synthetic dev PNGs and explicitly revokes6
prediction keys only;6 other-mode objects remain retained with exact inventories.
It cleans only its fixed `og05e2e-` DB scope. It verifies all modes/locales,
normal/Twitterbot identical200/no-store metadata, self identities, original PNG
bytes/dimensions, browser navigation, JS-free fallback, actual venue edit/new
version/correction, suspension of both corrected source and replacement, and
deleted/restored/malformed tuples. It never proves live CDN or X by simulation.
Only idempotent GET `ECONNRESET` can retry once; HTTP failures and writes do not.

The regression suite downloads actual personal prediction/result PNGs for all
three locales and exercises fan-board clipboard URLs with isolated localStorage.
API writes are blocked before the server, with a guard positive control. It
does not post to SNS or save ballots. Record actual event phases; a catalog
fixture in the wrong phase fails rather than impersonating a live/final event.
Keep existing unit503→recovery transport coverage distinct from deliberately
outaging a public deployment, which this runbook does not authorize.

For actual public Fes2 publications verify original PNG SHA/MIME/1200×630,
absolute access, canonical=og:url=self, noindex/follow, all locales/modes actually
selected, navigation/fallback and corrected/suspended notice behavior. Capture
real X unfurls for different modes/versions through an authorized platform
session. Twitterbot UA is separate evidence. An inaccessible/logged-out X
session is unverified, not a passing preview. Never post to SNS automatically.

Primary references: [manual workflows](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow),
[workflow triggers](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow),
[GitHub contexts](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts),
[cross-run artifact download](https://github.com/actions/download-artifact/blob/d3f86a106a0bac45b974a628896c90dbdf5c8093/README.md#download-artifacts-from-other-workflow-runs-or-repositories).
