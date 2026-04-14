# github-migration.md — GitHub Repository Migration

> Move repository from Chpark/opensetlist to opensetlistdb/opensetlist.
> Make repository public for CodeRabbit free plan.
> Update all local git settings and remote URLs.

---

## Overview

```
Before: github.com/Chpark/opensetlist (private)
After:  github.com/opensetlistdb/opensetlist (public)
```

---

## Step 1 — Check for secrets in git history

Run this BEFORE making repository public:

```bash
# Check for any secrets in commit history
git log --all -p | grep -iE "password|secret|api.key|database.url|token|supabase" | head -50

# Also check for .env files accidentally committed
git log --all --full-history -- .env
git log --all --full-history -- .env.local
git log --all --full-history -- .env.production
```

If anything shows up → do NOT proceed until secrets are removed from history.
If nothing shows up → safe to continue ✅

---

## Step 2 — Create GitHub Organization

```
1. github.com 접속 → 우상단 + 버튼 → New organization
2. Plan: Free
3. Organization name: opensetlistdb
4. Contact email: hello.opensetlist@gmail.com
5. 생성 완료
```

---

## Step 3 — Transfer Repository

```
1. github.com/Chpark/opensetlist 접속
2. Settings 탭
3. 하단 Danger Zone → Transfer repository
4. Type repository name: opensetlist
5. Choose new owner: opensetlistdb
6. 확인 → Transfer 완료

결과:
  github.com/Chpark/opensetlist
  → github.com/opensetlistdb/opensetlist 으로 이전
  (기존 URL은 자동 리다이렉트)
```

---

## Step 4 — Make Repository Public

```
1. github.com/opensetlistdb/opensetlist 접속
2. Settings 탭
3. 하단 Danger Zone → Change repository visibility
4. Make public 선택
5. opensetlistdb/opensetlist 입력 → 확인
```

---

## Step 5 — Update Local Git Remote

ClaudeCode가 실행:

```bash
# 현재 remote 확인
git remote -v

# remote URL 업데이트
git remote set-url origin https://github.com/opensetlistdb/opensetlist.git

# 변경 확인
git remote -v
# origin  https://github.com/opensetlistdb/opensetlist.git (fetch)
# origin  https://github.com/opensetlistdb/opensetlist.git (push)

# 연결 테스트
git fetch origin
```

---

## Step 6 — Re-add GitHub Secrets

이전 후 Secrets는 새 레포에 다시 설정 필요:

```
github.com/opensetlistdb/opensetlist
→ Settings → Secrets and variables → Actions → New repository secret

추가할 Secrets:
  DATABASE_URL_UNPOOLED     = [Production Supabase session pooler]
  PROD_DATABASE_URL         = [Production Supabase transaction pooler]
  PROD_DATABASE_URL_UNPOOLED = [Production Supabase session pooler]
  DEV_DATABASE_URL          = [Development Supabase transaction pooler]
  DEV_DATABASE_URL_UNPOOLED = [Development Supabase session pooler]
```

---

## Step 7 — Reconnect Vercel

```
1. vercel.com → 프로젝트 → Settings → Git
2. Disconnect 후 재연결
3. opensetlistdb/opensetlist 선택
4. 저장
```

또는 Vercel이 자동으로 감지할 수 있음 — 배포 확인 필요.

---

## Step 8 — Setup CodeRabbit

```
1. coderabbit.ai 접속
2. Sign in with GitHub
3. opensetlistdb organization 선택
4. opensetlist 레포 선택
5. Free plan (public repo) ✅
6. .coderabbit.yaml 파일 추가 (아래)
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

---

## Step 9 — Update README.md

```markdown
# OpenSetlist

애니메이션/게임 라이브 공연 셋리스트 데이터베이스

🌸 [opensetlist.com](https://opensetlist.com)

## Tech Stack

- Next.js 14 (App Router)
- TypeScript
- Prisma 7
- Supabase (PostgreSQL)
- Vercel

## Contact

hello.opensetlist@gmail.com
```

---

## Step 10 — Verify Everything Works

```bash
# 1. Local git 확인
git remote -v
# origin → opensetlistdb/opensetlist ✅

# 2. Push 테스트
git push origin main
# → github.com/opensetlistdb/opensetlist에 반영 ✅

# 3. GitHub Actions 확인
# opensetlistdb/opensetlist → Actions 탭
# → backup workflow 정상 동작 확인

# 4. Vercel 배포 확인
# → push 후 자동 배포 트리거 확인
# → opensetlist.vercel.app 정상 동작 확인
```

---

## Checklist

```
[ ] git history 시크릿 검사 완료
[ ] opensetlistdb Organization 생성
[ ] 레포 이전 (Transfer)
[ ] Public으로 전환
[ ] 로컬 git remote URL 업데이트
[ ] GitHub Secrets 재설정
[ ] Vercel 재연결 + 배포 확인
[ ] CodeRabbit 연결 + .coderabbit.yaml 추가
[ ] README.md 업데이트
[ ] GitHub Actions (backup) 정상 동작 확인
```
