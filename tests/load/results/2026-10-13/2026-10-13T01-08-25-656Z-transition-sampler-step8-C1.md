# Transition sampler — step8-C1 — SWITCHED

- base https://opensetlist.com (prod) · path `/ja/events/109/smoke-test-v0190` · event 109 · expected after the switch: dpl_8trbJx15YxL3tF9dexocYu2eJFq3
- host `CHPDesktop2024` · window 2026-10-13T01:08:25.656Z → 2026-10-13T01:11:30.281Z (UTC) · ended by STOP file · every 250 ms per loop
- clock: this host's clock, UTC. Switch latency = first expected answer − the operator's promote / rollback click time.

- first answer from dpl_8trbJx15YxL3tF9dexocYu2eJFq3: 01:09:23.659 (request start) → 01:09:26.236
- last answer from another deployment: 01:09:27.912 (dpl_84mZdx7b4ES7hafdQSNr9zagHrzk) · old tail after the first expected answer: 4253 ms
- sustained on dpl_8trbJx15YxL3tF9dexocYu2eJFq3 from: 01:09:28.163 · flips: 7 · other deployments seen: dpl_84mZdx7b4ES7hafdQSNr9zagHrzk
- doc samples 726 (attributed 726, **unattributed 0** = 0 %; > 20 % → INSUFFICIENT ATTRIBUTION) statuses {"200":726} · 5xx/errors 0
- api samples 733 statuses {"200":733} · 5xx/errors 0 (0 from 5 s before the first expected answer on)

## Deployment timeline (document answers, by request start)

| from (UTC) | to (UTC) | data-dpl-id | samples |
|---|---|---|---|
| 01:08:25.658 | 01:09:23.408 | dpl_84mZdx7b4ES7hafdQSNr9zagHrzk | 232 |
| 01:09:23.659 | 01:09:23.910 | dpl_8trbJx15YxL3tF9dexocYu2eJFq3 (expected) | 2 |
| 01:09:24.159 | 01:09:24.159 | dpl_84mZdx7b4ES7hafdQSNr9zagHrzk | 1 |
| 01:09:24.422 | 01:09:24.669 | dpl_8trbJx15YxL3tF9dexocYu2eJFq3 (expected) | 2 |
| 01:09:26.422 | 01:09:26.422 | dpl_84mZdx7b4ES7hafdQSNr9zagHrzk | 1 |
| 01:09:26.668 | 01:09:27.660 | dpl_8trbJx15YxL3tF9dexocYu2eJFq3 (expected) | 5 |
| 01:09:27.912 | 01:09:27.912 | dpl_84mZdx7b4ES7hafdQSNr9zagHrzk | 1 |
| 01:09:28.163 | 01:11:29.915 | dpl_8trbJx15YxL3tF9dexocYu2eJFq3 (expected) | 482 |

API answers carry no deployment id; their x-vercel-id values are in the JSON for a `vercel logs` join per deployment.
