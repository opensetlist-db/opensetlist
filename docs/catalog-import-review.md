# Catalog import review

Use this gate between the existing same-day snapshot and catalog delta, and before
the import plan runs. It applies to new and changed public names in general CSV
imports. Use the separate bonus review for album bonuses.

## Prepare the delta

1. Regenerate source CSVs and run the usual fixes. Treat generated names,
   placeholder fills and name copies as candidates. Match by stable slug and
   relationship, and compare against a fresh snapshot of the target database.
2. For each changed display field, record the original spelling and language,
   the stored value, the proposed value, and the exact source for each locale.
   Classify a standalone drama/BGM title and an event or series name as a title.
   Keep variant labels, names, venue, organizer, city and approved abbreviations
   separate. Verify that unchanged translations still describe the same thing
   if the original changed. Record how you resolved conflicts. Hold unresolved
   names and new abbreviations for operator review with reasons and source
   candidates. A blank needed translation remains missing.
3. Run the language review against the merged record and split held entries
   and their dependents from the ready files. Put dependent tracks, versions,
   artist/performer links, and event/series relationships in the same review.
   Existing external dependencies should already be confirmed in the fresh
   snapshot. Validate the ready files with the existing reference and delta
   checker, then build the import plan from only those files. Preserve the
   normal file order and event boundaries.
4. Recompare the ready inputs with the latest database values before applying.
   Stop on unexpected changes. CSV name columns patch nonblank values and
   preserve omitted or blank translated cells. To clear a stored translation
   intentionally, use its entity editor. For a verified identical value, put
   the source URL in the matching CSV column with `_same_source` appended,
   such as `va_en_name_same_source`. Attach the source excerpt or saved
   reference to the review. Import checks the attestation column's shape.

### Review input

Keep the JSON with the batch's source references and diff. Each entry names a
row or an inseparable group. Use stable `entity:slug` keys, for example
`song:demo`, so references to pending records can be picked up from the CSV.
List any additional dependency in `dependsOn`. `fields` contains the effective
values after the candidate patch. `csv` carries the corresponding rows from
the prepared delta, with filenames beginning with the import type.
The exporter checks the reviewed values against the real CSV cells.
Add `stored` with `original`, `originalLanguage` and `translations` from the
latest snapshot when the effective value includes an omitted CSV cell.
Use `csvIndex` for a field on a subsequent row and `prefix` for fields such as
`series_` and `va_`. A held entry may have empty fields and no CSV rows.

```json
{
  "entries": [
    {
      "key": "album:demo",
      "dependsOn": [],
      "fields": [{
        "field": "title",
        "kind": "title",
        "original": "Day.1",
        "originalLanguage": "ja",
        "originalSource": "fixed-fixture:original",
        "translations": []
      }],
      "csv": [{
        "file": "albums.csv",
        "header": ["slug", "originalTitle", "originalLanguage"],
        "row": ["demo", "Day.1", "ja"]
      }]
    },
    {
      "key": "song:pending",
      "hold": "KO sources conflict",
      "sourceCandidates": ["review-note:source-a", "review-note:source-b"],
      "fields": []
    },
    {
      "key": "album:pending",
      "dependsOn": ["song:pending"],
      "fields": [{
        "field": "title",
        "kind": "title",
        "original": "Day.2",
        "originalLanguage": "ja",
        "originalSource": "fixed-fixture:original",
        "translations": []
      }]
    }
  ]
}
```

Omit `kind` for names or variant labels. A translation entry carries `locale`,
`value`, and `source`. Set `sameValueConfirmed` only when the source verifies the
same spelling for that locale. The ready export keeps supplied row order. Store
one version of the report per target database.

```sh
node scripts/catalog-display-review.mjs candidate.json --ready-dir ready > review.json
node scripts/catalog-display-review.mjs stored.json --audit > audit.json
```

## Verify and hand off

- Inspect the import result and re-export the affected rows from the target DB.
  Run the same review on the stored names with `--audit`, keeping explicit holds
  and their dependencies in the report. Record excluded, held, missing,
  title-review, and unconfirmed-same separately.
- Compare old, planned, and stored values. Check IDs, slugs, original text,
  relationships, dates and existing user records. For an import error, inspect
  earlier rows before retrying. Setlist replacement is atomic per event. Follow
  the existing replacement safeguards if a setlist has user records.
- Request a fresh public page in KO, JA and EN for representative entries.
  For shared dev QA, use an isolated prefix and confirm the fixture and owned
  rows are gone after guarded cleanup.
- Hand off the exact delta and source references, fresh snapshot and import
  evidence, audit counts, held dependencies and responsible reviewer. Report
  preparation, dev apply and verification, and production apply separately.
