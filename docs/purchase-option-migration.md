# Purchase option identity migration

Apply [purchase-option-identity.sql](../prisma/purchase-option-identity.sql) once to an existing database before deploying the code that reads the new fields. Use the environment’s session connection and the normal backup process for production. For a fresh database, use the normal Prisma schema and post-deploy SQL instead.

The transaction adds fields and creates two replacement unique indexes before dropping the old indexes. Legacy importer rows still have one entry per album, store and edition. The transaction rolls back if existing benefit overrides would change under the intersection of the sale and benefit periods. Review conflicting rows against the original sources before rerunning. Do not turn off the general schema drop guard.

Verify the usual schema workflow after this targeted step. Review legacy performance-linked choices individually. A null video eligibility field means unverified, so these choices are hidden from performance guidance until verified. Existing rows, URLs, and end states are kept. For a release with only an official source, save the official product information URL on a source-only listing and leave its product URL empty.
