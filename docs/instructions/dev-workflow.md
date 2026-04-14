# dev-workflow.md — Development Workflow & Release Strategy

> Separates production and development environments.
> Prevents accidental production damage during development.
> Uses tag-based releases for controlled production deployments.

---

## Branch Strategy

```
main (production)
  ← merged from release tags only
  ← hotfix/* for emergency fixes

dev (development)
  ← merged from feature/* branches
  ← staging environment

feature/xxx
  ← individual feature branches
  ← merged into dev via PR
```

### Rules

```
main:
  Direct commits FORBIDDEN
  Only merged via PR from dev or hotfix/*
  Every merge = new tag = production deploy

dev:
  Primary development branch
  Auto-deploys to Vercel Preview with dev DB
  Test here before releasing

feature/xxx:
  One branch per feature
  Naming: feature/member-page, feature/og-cards
  Merged into dev via PR

hotfix/xxx:
  Emergency production fixes only
  Naming: hotfix/setlist-display-bug
  Merged directly into main + tag
  Also merged back into dev
```

---

## Environment Separation

### Supabase — Two Projects

```
Production project (existing):
  Used by: main branch, opensetlist.com
  Secrets: PROD_DATABASE_URL, PROD_DATABASE_URL_UNPOOLED

Development project (create new):
  Used by: dev branch, feature branches, local
  Free plan sufficient
  Secrets: DEV_DATABASE_URL, DEV_DATABASE_URL_UNPOOLED
```

### Create Development Supabase Project

```
1. supabase.com → New Project
2. Name: opensetlist-dev
3. Region: Northeast Asia (Seoul)
4. Copy connection strings to .env.local
```

### Vercel Environment Variables

```
Go to: Vercel → Settings → Environment Variables

Production (main branch only):
  DATABASE_URL              = [Production Supabase transaction pooler]
  DATABASE_URL_UNPOOLED     = [Production Supabase session pooler]
  NEXT_PUBLIC_BASE_URL      = https://opensetlist.com

Preview (dev + feature branches):
  DATABASE_URL              = [Development Supabase transaction pooler]
  DATABASE_URL_UNPOOLED     = [Development Supabase session pooler]
  NEXT_PUBLIC_BASE_URL      = https://opensetlist.vercel.app

Development (local):
  (set in .env.local — same as Preview values)
```

### GitHub Secrets

```
Go to: github.com/Chpark/opensetlist → Settings → Secrets → Actions

Add:
  PROD_DATABASE_URL          = [Production Supabase transaction pooler]
  PROD_DATABASE_URL_UNPOOLED = [Production Supabase session pooler]
  DEV_DATABASE_URL           = [Development Supabase transaction pooler]
  DEV_DATABASE_URL_UNPOOLED  = [Development Supabase session pooler]
```

---

## Release Strategy — Tag Based

### Normal Release Flow

```
1. Create feature branch
   git checkout dev
   git checkout -b feature/member-page

2. Develop + test locally (dev DB)
   npm run dev

3. Push + PR to dev
   git push origin feature/member-page
   → Create PR: feature/member-page → dev
   → GitHub Actions: schema migration on dev DB ✅
   → Vercel Preview URL generated ✅
   → Review + merge

4. Test on dev branch Preview URL
   Verify everything works with dev DB

5. When ready to release: PR dev → main
   git checkout main
   git merge dev
   git push origin main
   → Do NOT deploy yet (no tag)

6. Create release tag
   git tag v1.1.0
   git push origin v1.1.0
   → GitHub Actions triggered
   → Schema migration on PROD DB ✅
   → Vercel Production deployment ✅
```

### Emergency Hotfix Flow

```
1. Create hotfix branch from main
   git checkout main
   git checkout -b hotfix/setlist-display-bug

2. Fix + test

3. Merge into main + tag
   git checkout main
   git merge hotfix/setlist-display-bug
   git tag v1.1.1
   git push origin main --tags
   → Production deploy triggered ✅

4. Also merge into dev (keep in sync)
   git checkout dev
   git merge hotfix/setlist-display-bug
   git push origin dev
```

---

## Version Numbering

```
Format: vMAJOR.MINOR.PATCH

MAJOR: Breaking changes or major feature releases
  v1.0.0  Initial launch
  v2.0.0  Complete redesign

MINOR: New features
  v1.1.0  Member page added
  v1.2.0  Setlist prediction game added
  v1.3.0  User accounts added

PATCH: Bug fixes
  v1.0.1  Song page display fix
  v1.1.1  Emergency hotfix

Examples:
  v1.0.0  Launch (2026-05-02)
  v1.0.1  Post-launch bug fixes
  v1.1.0  Community features (Phase 2)
  v1.2.0  Prediction game (Phase 3)
```

---

## GitHub Actions Workflows

### 1. Schema Migration on dev DB (on PR to dev)

`.github/workflows/migrate-dev.yml`

```yaml
name: Migrate Dev DB

on:
  push:
    branches: [dev]

jobs:
  migrate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm install
      - name: Push schema to dev DB
        env:
          DATABASE_URL: ${{ secrets.DEV_DATABASE_URL_UNPOOLED }}
        run: npx prisma db push
```

### 2. Schema Migration on prod DB (on tag)

`.github/workflows/migrate-prod.yml`

```yaml
name: Migrate Production DB

on:
  push:
    tags:
      - 'v*'  # Triggered by any tag starting with v

jobs:
  migrate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm install
      - name: Push schema to production DB
        env:
          DATABASE_URL: ${{ secrets.PROD_DATABASE_URL_UNPOOLED }}
        run: npx prisma db push
      - name: Verify migration
        env:
          DATABASE_URL: ${{ secrets.PROD_DATABASE_URL_UNPOOLED }}
        run: npx prisma db pull --print
```

### 3. Daily Backup (existing — production only)

`.github/workflows/backup.yml` (already set up ✅)

---

## AI Code Review — CodeRabbit

### Why CodeRabbit

```
혼자 개발 시 내가 놓친 것을 AI가 잡아줌:
  Null checks on Prisma queries
  N+1 query patterns
  Missing error handling in API routes
  Hardcoded values that should be env vars
  TypeScript type safety issues
  Next.js best practices (next/image 등)

PR 수 제한 없음 → $12/월 (Private 레포)
40개 이상 linter 연동 + AI 분석 동시에
PR 댓글로 @coderabbitai 태그해서 AI와 대화 가능
```

### Setup

```
1. coderabbit.ai 접속
2. GitHub 계정 연결
3. opensetlist 레포 선택
4. 결제 ($12/월)
5. .coderabbit.yaml 추가 (아래 참고)
```

### .coderabbit.yaml

프로젝트 루트에 생성:

```yaml
language: "ko-KR"

reviews:
  high_level_summary: true
  poem: false
  review_status: true
  auto_review:
    enabled: true
    drafts: false
    ignore_title_keywords:
      - "WIP"
      - "chore"
      - "docs"

  path_filters:
    - "!.next/**"
    - "!node_modules/**"
    - "!prisma/migrations/**"
    - "!public/**"
    - "!*.md"

  instructions: |
    This is a Next.js 14 (App Router) + TypeScript + Prisma 7 + Supabase project.
    It is a setlist database for Japanese anime/game live events targeting Korean users.

    Focus on:
    - Null checks on Prisma query results (findUnique/findFirst can return null)
    - N+1 query patterns in loops
    - Missing error handling in API routes and server actions
    - Hardcoded values that should be environment variables
    - Type safety issues (avoid any)
    - Missing loading/error states in React components
    - BigInt handling (IDs are BigInt in Prisma schema)
    - Locale handling in i18n (next-intl)

    Skip:
    - Stylistic preferences already handled by ESLint
    - Comments about adding more tests (no test suite yet)
    - Suggestions to add logging
```

### PR에서 CodeRabbit 활용

```
자동 리뷰:
  PR 생성 시 자동으로 리뷰 댓글 추가

수동 질문:
  PR 댓글에 @coderabbitai 태그
  e.g. "@coderabbitai 이 쿼리에 N+1 문제 있어?"
       "@coderabbitai 더 나은 방법 있어?"

리뷰 무시:
  특정 줄 무시: // coderabbitai: ignore
  전체 파일 무시: path_filters에 추가
```

---

## Pre-Launch Testing Checklist

Before opening opensetlist.com, verify this workflow works end-to-end:

```
[ ] Create dev Supabase project
[ ] Set Vercel environment variables (Production vs Preview)
[ ] Add GitHub Secrets (PROD_* and DEV_*)
[ ] Create dev branch
    git checkout -b dev
    git push origin dev
[ ] Make a test schema change on feature branch
    e.g. add a comment field to Song
[ ] PR feature → dev
    → Check: migrate-dev.yml runs ✅
    → Check: Vercel Preview URL uses dev DB ✅
[ ] PR dev → main
    → No tag yet → No production deploy ✅
[ ] Create tag v0.9.0
    → Check: migrate-prod.yml runs ✅
    → Check: Vercel Production deploys ✅
    → Check: opensetlist.vercel.app reflects change ✅
[ ] Revert test schema change
[ ] Ready to launch 🚀
```

---

## Day-of-Concert Emergency Protocol

```
공연 당일 버그 발견 시:

긴급도 낮음 (셋리스트 입력에 영향 없음):
  → 다음 릴리즈에 포함
  → hotfix 불필요

긴급도 높음 (셋리스트 입력 불가 등):
  git checkout -b hotfix/description
  → Fix
  → git checkout main
  → git merge hotfix/description
  → git tag v1.x.x (patch)
  → git push origin main --tags
  → 5분 내 프로덕션 반영

DB 문제 시:
  → GitHub Actions에서 수동 백업 트리거
  → Supabase 대시보드에서 직접 수정
```
