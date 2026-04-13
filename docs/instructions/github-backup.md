# github-backup.md — Automated Daily DB Backup via GitHub Actions

> Supabase Free plan has no automatic backups.
> This sets up a daily pg_dump backup stored as GitHub Actions artifacts.
> Retention: 30 days. Free. No additional services needed.

---

## Overview

```
Schedule: daily at 00:00 KST (15:00 UTC)
Method:   pg_dump → .sql file → GitHub Actions artifact
Storage:  GitHub (retained 30 days)
Manual:   can trigger anytime from GitHub Actions tab
```

---

## Step 1 — Add secret to GitHub repository

Go to: github.com/Chpark/opensetlist → Settings → Secrets and variables → Actions → New repository secret

Add:
```
Name:  DATABASE_URL_UNPOOLED
Value: (copy from .env.local — the session pooler URL, port 5432)
```

Note: Use DATABASE_URL_UNPOOLED (port 5432, session pooler), NOT the transaction pooler.
pg_dump requires a direct/session connection, not a transaction pooler.

---

## Step 2 — Create workflow file

Create `.github/workflows/backup.yml`:

```yaml
name: Daily Database Backup

on:
  schedule:
    # Every day at 15:00 UTC = 00:00 KST
    - cron: '0 15 * * *'
  workflow_dispatch:
    # Allow manual trigger from GitHub Actions tab

jobs:
  backup:
    runs-on: ubuntu-latest

    steps:
      - name: Install PostgreSQL client
        run: |
          sudo apt-get update
          sudo apt-get install -y postgresql-client

      - name: Run pg_dump
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL_UNPOOLED }}
        run: |
          pg_dump "$DATABASE_URL" \
            --no-owner \
            --no-acl \
            --format=plain \
            --file=backup-$(date +%Y-%m-%d).sql

      - name: Upload backup artifact
        uses: actions/upload-artifact@v4
        with:
          name: db-backup-${{ github.run_number }}-${{ github.run_attempt }}
          path: backup-*.sql
          retention-days: 30
          if-no-files-found: error
```

---

## Step 3 — Verify it works

1. Go to github.com/Chpark/opensetlist → Actions tab
2. Select "Daily Database Backup" workflow
3. Click "Run workflow" → Run workflow (manual trigger)
4. Wait for it to complete (should take ~1 min)
5. Click the completed run → Artifacts section
6. Download and verify the .sql file has data

---

## Restoring from backup

If DB needs to be restored:

```bash
# Download the .sql artifact from GitHub Actions

# Restore to Supabase
psql $DATABASE_URL_UNPOOLED < backup-2026-05-02.sql
```

Or if starting fresh (DB wiped):
```bash
# 1. Push schema
npx prisma db push

# 2. Restore data
psql $DATABASE_URL_UNPOOLED < backup-2026-05-02.sql
```

---

## Notes

- Artifacts are private (only repo members can download)
- 30 day retention = last 30 daily backups always available
- If a backup run fails, GitHub sends email notification to repo owner
- After concert days (5/2, 5/3, 5/23...) consider manual trigger
  to get an immediate backup of freshly entered setlist data:
  Actions tab → Daily Database Backup → Run workflow
