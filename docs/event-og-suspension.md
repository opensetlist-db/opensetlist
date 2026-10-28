# Event share-card public suspension

This is an explicit exception for one published version with serious incorrect
or rights-sensitive content. It never cancels an event, changes setlists,
automatically stops older modes, republishes a card or recalls downloaded/SNS
copies. Ordinary corrections use a freshly reviewed publication instead.

## Scope and prerequisite inventory

Read `node scripts/event-og.mjs list --event <id>` and retain the exact mode,
revision and annotation version. Confirm the three saved asset keys/hashes and
all active delivery paths for their bucket. Suspend only an intended version;
use new synthetic dev assets for verification.

`EVENT_CARD_DELIVERY_BASES` is a JSON array of the bucket's complete active
HTTPS public bases, including `R2_PUBLIC_BASE_URL` and any active custom-domain
or r2.dev aliases. Omitted/mismatched inventory fails safely. URLs or keys are
never accepted as command-line deletion targets. Keep configuration private.
Previously saved URLs may use any inventoried base after a primary-domain
change; keep that previous alias inventoried while it can still serve objects.
Do not infer the inventory from DNS alone or assume a custom-domain WAF also
blocks a separately enabled r2.dev endpoint.

Custom-domain caches additionally require `CLOUDFLARE_CACHE_ZONE_ID`,
`CLOUDFLARE_CACHE_ZONE_HOST` and `CLOUDFLARE_CACHE_PURGE_TOKEN` with Zone Cache
Purge permission. This is separate from R2 S3 DeleteObject permission. All
custom hosts must belong to the configured zone. Multiple zones need a later
explicit configuration design; do not silently purge a different zone.

## Operator procedure

Save a private UTF-8 reason (nonempty, at most1,000 characters, no NUL), retain
an operation UUID, and run the dev-only guarded CLI:

```powershell
node scripts/event-og.mjs suspend --event <id> --mode prediction --revision <publication-UUID> --expected-version <version> --operation <decision-UUID> --reason-file <private-reason.txt>
```

The command first commits a safe annotation and immutable suspension decision
under the event/mode graph lock shared with correction and publishing. All
three old share URLs then return200 with localized neutral metadata and an
accessible event link. They stay on the notice, omit the problematic frozen
content/image and keep no-store. Direct uncached DB reads need no standalone
CLI `revalidateTag` call. A deleted event still stays404 publicly, but its owned
images can be stopped. Private reasons never appear in a public response.

Next, an auditable delivery attempt performs only the exact publication's three
origin HEAD/hash checks, DELETEs and absent-HEAD verification. It purges the
publication UUID directory prefix on custom domains, covering query/header
cache-key variants. No wildcard, bucket purge, whole-zone purge, overwritten
placeholder bytes or broad asset deletion operation is exposed.

Finally it requests the original public URLs, a stable query variant and an
Origin-header variant with normal/Twitterbot semantics. No cache-busting nonce
or no-cache header can substitute for checking a still-serving cached copy.
Purge acceptance alone is insufficient: the configured owned paths must stop
serving. Neighbor publications remain available. r2.dev has no Cloudflare edge
cache, so its cache stage is `not-needed`, not a successful live CDN purge.

## Results, failures and retries

`suspended`/exit0 means the saved notice and this attempt's configured delivery
scope were verified. `partial`/exit1 prints JSON with `safeNoticeApplied:true`,
per-key origin outcomes, cache status/prefixes, actual URL observations and
unsettled writers. The safe notice remains even if DELETE, purge, permissions
or verification fail. Fix configuration/permissions and retry the **same exact
operation UUID and inputs**. Never invent success from an API acceptance or
replace a key with new bytes.

Same-ID retries retain one decision and append attempts; stale versions,
different reasons under the same UUID and a new decision on an already
suspended version are explicit conflicts. Inspect history instead of changing
the expected version to suppress a conflict. `outcome_unknown` is a failure:
the notice/DELETE may already have committed. Retain the exact input and retry
it to reconcile and verify. Unfinished attempt records are preserved.

Publishing now takes the same graph lock, rechecks committed identity before
any PUT, and keeps a durable writer fence before external writes. A completed
publication retry never re-PUTs removed objects. If a PUT response or process
disappears, an unsettled writer fence prevents false complete suspension even
when current GETs return404. There is no automatic lease expiry or force-clear
command. Any writer observed at the start of a revocation attempt makes that
attempt partial even if it settles during verification: retry the same operation
after its acknowledgment so DELETE/purge/GET run again. Restore the writer's
acknowledged completion or investigate with the
owner/provider; do not delete that audit row to manufacture revocation proof.
Even an ordinary failed PUT followed by a successful publication retry cannot
settle the earlier uncertain request. That publication's notice and origin
deletion still work, but completion remains `partial` indefinitely unless the
original writer acknowledges its requests. This conservative limitation is
explicitly retained: this ticket provides no audited quiescence/credential
rotation recovery tool and cannot prove a crashed writer will never resume.
Escalate unresolved writer IDs to the owner; repeating the command alone does
not resolve them. Do not present this case as a completed suspension.

The decision transaction allows90s for a publisher's60s graph-lock transaction.
Pool exhaustion or a longer queue can still fail before the notice commits;
check the saved decision and retry the same operation rather than assuming
the notice was applied. Only404/410 count as blocked delivery. A403/WAF error
or network failure is incomplete evidence, even if it hides the image locally.

The publication snapshot, hashes, targets, earlier correction decisions,
timestamps and private reasons remain in server-only tables. Delivery-attempt
reports do not overwrite earlier failure evidence. Public suspension has no
restore/republish command in this ticket.

## Verification and current limit

```powershell
npx vitest run src/__tests__/unit/event-og-delivery.test.ts src/__tests__/unit/event-og-publication.test.ts
npx vitest run -c vitest.integration.config.ts src/__tests__/integration/event-og-suspension.test.ts
# Matching production build/start; dev DB and opensetlist-images-dev only:
$env:EVENT_CARD_R2_E2E='1'; $env:R2_KEY_PREFIX='test'
$env:NEXT_PUBLIC_BASE_URL='http://127.0.0.1:3195'; $env:TEST_BASE_URL=$env:NEXT_PUBLIC_BASE_URL
npx playwright test tests/e2e/event-og-suspension.spec.ts
```

The opt-in E2E publishes nine synthetic PNGs, explicitly revokes only the three
prediction images, records every key/outcome and leaves the other six retained.
It tests missing-inventory partial output before a same-operation retry, actual
old URLs, three localized notices, keyboard/mobile/no-JS and unaffected modes.
Only `og04e2e-` DB fixtures/history are cleaned. Normal unit tests do not contact
the DB, bucket or Cloudflare.

The owner's current dev setup has **no separate cached custom domain or purge
permission configuration**. Real dev r2.dev origin verification and simulated
custom-domain cache tests are separate evidence. Live custom-domain CDN purge
remains unverified; do not mark the ticket complete or production suspension
ready from the uncached dev result. Record all aliases/cache rules, permission
proof, warmed original/query/header URLs before and after purge, and unchanged
neighbor assets when that dev infrastructure becomes available. Third-party
social caches and already downloaded/browser-cached copies cannot be recalled.
