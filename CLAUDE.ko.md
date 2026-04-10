# CLAUDE.ko.md — OpenSetlist (opensetlist.com)

> 모든 아키텍처, 설계, 개발 결정의 단일 진실 공급원.
> 결정이 내려지거나 변경될 때마다 이 파일을 업데이트하세요.
> 새 Claude Code 세션을 시작할 때 이 파일을 먼저 읽으세요.

---

## 프로젝트 개요

**OpenSetlist**는 애니메이션, 게임, 아시아 음악 라이브 이벤트를 위한 크라우드소싱 셋리스트 데이터베이스입니다.
setlist.fm과 유사하지만 동아시아 콘텐츠에 특화 — 한국, 일본, 영어, 중국 유저 대상.

- **사이트:** opensetlist.com
- **Phase 1 타겟:** 한국 유저, 애니/게임 음악 IP
- **차별점:** setlist.fm에 전혀 없는 유닛/멤버 레벨 셋리스트 상세 정보
- **모델:** 크라우드소싱 데이터 + 커뮤니티 토론 게시판

---

## 현재 진행 상황

```
✅ opensetlist.com 등록 (Namecheap, WHOIS 프라이버시 ON)
✅ hello.opensetlist@gmail.com 생성
✅ Google Search Console 인증 (DNS TXT 레코드)
✅ Instagram @opensetlist 등록
✅ Twitter/X @opensetlistdb 등록
✅ GitHub 레포: github.com/Chpark/opensetlist (비공개)
✅ Next.js 14 초기화 (TypeScript, Tailwind, App Router, src/ 디렉토리)
✅ Prisma 7 설정 (프로젝트 루트에 prisma.config.ts)
✅ Supabase PostgreSQL — 모든 테이블 생성 및 확인 완료
✅ DB 연결 확인 (/api/health → { status: "ok", db: "connected" })
✅ src/lib/prisma.ts 싱글톤 생성
✅ 스키마 v9 확정 (core + community, 열거형 + GIN 인덱스 + BigInt ID)

⏳ Vercel — Chpark/opensetlist 레포 연결, 환경 변수 추가
⏳ next-intl — i18n 설정 (/[locale]/ 라우팅, 한국어 우선)
⏳ 관리자 데이터 입력 UI — Phase 1A 시드 데이터용
⏳ 핵심 공개 페이지 — Song, Event, Artist
⏳ Kakao AdFit 신청
⏳ EIN 발급 (IRS: 1-800-829-4933, 화~목 오전 7~9시 PT)
```

---

## 기술 스택

| 레이어 | 기술 | 비고 |
|---|---|---|
| 프레임워크 | Next.js 14 (App Router) | SEO를 위한 SSR |
| 언어 | TypeScript | Strict 모드 |
| i18n | next-intl | /[locale]/ 라우팅 |
| 인증 | NextAuth.js | Phase 1B |
| ORM | Prisma 7 | prisma.config.ts 패턴 |
| 데이터베이스 | PostgreSQL (Supabase 서울) | 무료 → Phase 2에서 Pro |
| 검색 | pg_tsvector → Meilisearch Cloud → 자체 호스팅 | 검색 전략 참조 |
| 캐시 | Redis (Upstash 서울) | Phase 2 |
| 이미지 | Cloudflare R2 | Phase 2 — MVP에서는 자체 호스팅 없음 |
| 호스팅 | Vercel (프론트엔드) | 무료 티어 |
| CDN | Cloudflare | 무료 |

---

## Prisma 7 설정

**중요:** Prisma 7은 DB 연결을 schema.prisma 밖으로 이동.

### prisma.config.ts (프로젝트 루트)
```typescript
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
```

### .env / .env.local
```env
# 트랜잭션 풀러 — Vercel 서버리스 런타임 (포트 6543)
DATABASE_URL="postgresql://postgres.[ref]:[pw]@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres"

# 세션 풀러 — Prisma 마이그레이션용 (포트 5432, IPv4 호환)
DATABASE_URL_UNPOOLED="postgresql://postgres.[ref]:[pw]@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres"
```

### 핵심 명령어
```bash
npx prisma db push        # 스키마를 DB에 푸시
npx prisma generate       # db push 후 별도 실행 필요 (Prisma 7)
npx prisma studio         # 시각적 DB 브라우저
```

---

## 스키마 설계 — 최종 v9 + Community v4

전체 스키마: `prisma/schema.prisma` (634줄)

### ID 전략
```
BigInt @default(autoincrement()) — 공개 URL에 나타나는 테이블:
  Artist, Song, Event, EventSeries, SetlistItem
  → URL 예: /artists/42, /songs/789, /events/123

String @default(uuid()) — 그 외 모든 테이블:
  Group, StageIdentity, RealPerson, Album
  User (순차적 ID가 추측 가능하면 안 됨)
  모든 junction, translation, community 테이블
```

### 소프트 삭제 전략
```
isDeleted Boolean @default(false)
deletedAt DateTime?

적용: Artist, Song, Event, EventSeries, SetlistItem, User
미적용: Junction 테이블, Translation 테이블
  (부모가 소프트 삭제되면 이것들은 하드 삭제)
```

### 열거형 전략
고정값 문자열 필드는 모두 Prisma 열거형 사용 (PostgreSQL enum 타입):
```
GroupType          franchise | label | agency | series
GroupCategory      anime | kpop | jpop | cpop | game
ArtistType         solo | group | unit | band
StageIdentityType  character | persona
EventSeriesType    concert_tour | festival | fan_meeting | one_time
EventType          concert | festival | fan_meeting | showcase
EventStatus        upcoming | ongoing | completed | cancelled
SetlistItemStageType  full_group | unit | solo | special
SetlistItemStatus  rumoured | live | confirmed
SongArtistRole     primary | featured | cover
AlbumType          single | album | ep | live_album | soundtrack
```

### GIN 인덱스
Comment 롤업 배열 필드 모두 GIN 인덱스 사용 (ANY() 쿼리 효율화):
```prisma
@@index([rollupSongIds], type: Gin)
@@index([rollupEventIds], type: Gin)
@@index([rollupEventSeriesIds], type: Gin)
@@index([rollupArtistIds], type: Gin)
@@index([rollupGroupIds], type: Gin)
@@index([rollupCategories], type: Gin)
```

### 주요 설계 결정

**서브유닛은 Artist 엔티티** — Cerise Bouquet, DOLLCHESTRA, Mira-Cra Park!은 `parentArtistId → 蓮ノ空`인 Artist 행.

**곡 버전** — "Dream Believers (SAKURA Ver.)"는 `baseVersionId → "Dream Believers"`, `variantLabel: "SAKURA Ver."`.

**메들리** — `SetlistItemSong` junction + `order` 필드. SetlistItem에 직접 songId 없음.

**콜라보** — `SongArtist` junction + `role`. "Link to the FUTURE" → 행 3개.

**다수 아티스트 이벤트** — 이차원 페스는 `artistId: null`, `organizerName: "Bandai Namco / Lantis"`.

**이벤트 레그 그룹화** — `Event.parentEventId` 자기참조. "고베 Day 1" + "Day 2"는 공통 `parentEventId → "고베 레그"`. 레그 컨테이너는 `date: null`.

**VA 교체** — `RealPersonStageIdentity`의 `startDate`/`endDate`. `SetlistItemMember.realPersonId`는 항상 명시적, 날짜로 추론하지 않음.

**댓글 게시판** — SetlistItem, Song, Event, EventSeries, Artist, Group(hasBoard=true). StageIdentity와 RealPerson은 설계상 제외 (안전 + 중복성).

**댓글 롤업** — 서버에서 작성 시 계산된 6개 GIN 인덱스 배열, 생성 후 불변. `rollupGroupIds`는 `hasBoard=true`인 그룹만 포함.

---

## URL 전략

```
표준형:  /[locale]/songs/789
표시형:  /[locale]/songs/789/hanamusubi
리다이렉트: 모든 슬러그 변형 → 표준 숫자 ID

예시:
  /ko/songs/789/하나무스비
  /ko/artists/42/cerise-bouquet
  /ko/events/123/4th-live-kobe-day-2
  /ko/series/7/4th-live-dream-bloom
```

숫자 ID가 표준형 — 슬러그는 SEO/가독성을 위한 장식용.

---

## 검색 전략

```
Phase 1A: Supabase pg_tsvector
  → 무료, 내장, 인프라 없음
  → 초기 데이터 볼륨에서 기본 한국어/일본어 검색 충분

Phase 2: Meilisearch Cloud
  → 더 나은 다국어 품질 (일본어/한국어)
  → 관리형 서비스, 운영 부담 없음
  → 일일 인덱스 덤프 → Cloudflare R2 백업

Phase 3: Vultr 서울 자체 호스팅 ($6/월)
  → Meilisearch Cloud 비용 정당화될 때
  → Kuromoji (일본어) + Jieba (중국어) 토크나이저
  → 인덱스 필드 최소화 (notes, descriptions 제외)
```

---

## 번역 전략

**지연 (사용자 요청) 번역 — 자동 번역 아님.**

```
기본:    원본 언어로 댓글 표시
UI:     비한국어 댓글에 "번역 보기" 버튼 표시
클릭 시: 번역 API 호출 → CommentTranslation에 캐시 → 표시
효과:   자동 번역 대비 ~80% 비용 절감
```

**API 우선순위:**
- ko ↔ ja: Papago (최고 품질, 무료 티어 한도 확인 필요)
- 기타: DeepL
- ja → zh-CN: Tencent Cloud MT (Phase 3, DeepL보다 품질 우수)
- 폴백: Google Translate

---

## 댓글 시스템

### 게시판
```
✅ SetlistItem, Song, Event, EventSeries, Artist, Group (hasBoard=true)
❌ StageIdentity, RealPerson, Album (설계상 제외)
```

### 롤업 앤세스트리 (6개 배열)
어느 레벨에 달린 댓글도 모든 상위 게시판에 표시:
```
rollupSongIds[]        — 메들리 지원 (SetlistItem당 여러 곡)
rollupEventIds[]       — 리프 이벤트 + 모든 조상 이벤트
rollupEventSeriesIds[] — 직접 + 모든 조상 시리즈
rollupArtistIds[]      — 직접 + 모든 상위 아티스트
rollupGroupIds[]       — hasBoard=true만 (관리자 제어)
rollupCategories[]     — ["anime"] | ["kpop"] 등
```

### 거버넌스
- `rollupGroupIds`는 작성 시점에 `hasBoard=true`인 그룹만 포함
- `hasBoard`는 관리자 전용 토글 — 무제한 게시판 생성 방지
- 댓글 볼륨 임계값 초과 시 hasBoard=true 자동 추천

### 무결성
- 타겟 필드: 생성 후 불변
- 앤세스트리 필드: 생성 후 불변 (수정 시 관리자 재인덱스 작업)
- 내용: 소유자만 수정 가능 → CommentEdit에 기록
- 소프트 삭제만 (isDeleted=true, 내용 → "[deleted]")

### 라이브 이벤트 지원
- `Event.status = ongoing` → 실시간 모드 활성화
- `SetlistItem.status = live` → 현재 공연 중
- `SetlistItem.status = rumoured` → 이벤트 전 팬 예측
- `Comment.mentionedSongId` → SetlistItem 생성 전 선택적 곡 태그
- Supabase Realtime 구독 (Phase 3)

---

## 이미지 정책

**MVP: 자체 호스팅 이미지 없음.**
```
imageUrl 필드에 공식 소스를 가리키는 외부 URL 저장
저작권 이미지 다운로드 또는 재호스팅 없음
```

**Phase 2:**
- TOS 포함 사용자 기여 이미지 ("업로드 권한이 있음을 확인")
- 모든 업로드 → Cloudflare R2

**Phase 3:**
- 레이블/에이전시에 공식 이미지 라이선스 요청
- CDJapan 제휴 파트너가 상품 이미지 허용할 수 있음

---

## 시드 데이터 전략

운영자가 정확성을 직접 검증할 수 있는 3개 IP에 집중.

### 대상 IP

**Love Live! 시리즈** — μ's, Aqours, 니지가사키, Liella!, 하스노소라 (전체 라이브)
- 한국 커뮤니티: DC인사이드 러브라이브 갤러리, Naver 러브라이브 팬 카페
- 테스트: 서브유닛, VA 교체, 멀티 레그 투어, 곡 변형, 메들리, 멀티 아티스트 이벤트

**우마무스메** — STARTING GATE, 3rd EVENT, 4th EVENT, MAKE A NEW TRACK!!
- 한국 커뮤니티: DC인사이드 우마무스메 갤러리, 아라뱃 카페
- 테스트: 대규모 StageIdentity 캐스트, VA-as-character, 페스티벌형 이벤트

**학원아이돌마스터** — 1st LIVE "We're GakoMas!"
- 한국 커뮤니티: DC인사이드 아이돌마스터 갤러리
- 테스트: 신규 프랜차이즈, Idolmaster Group 계층, 이차원 페스 교차 참조

### 목표 볼륨
출시 시 ~125개 이벤트, ~2500개 셋리스트 항목

### 데이터 소스 (참고용 — 자동 스크래핑 없음)
- namu.wiki — 세 IP 모두 상세한 한국어 정보
- Fandom wiki — 영어 구조화 데이터
- VGMdb — 앨범/곡 데이터 및 발매일
- Twitter/X 팬 스레드 — 참석자의 셋리스트 확인
- YouTube 콘서트 영상 + 댓글

---

## 개발 로드맵

### Phase 1A — 데이터 기반 구축 (4–6주)
**목표:** 시드 데이터가 있는 작동하는 사이트. 수익화, 유저 계정, 댓글 없음.

#### 1–2주차: 인프라
- [ ] Vercel — Chpark/opensetlist 연결, 환경 변수 추가
- [ ] next-intl 설정 — /[locale]/ 라우팅, 한국어만
- [ ] 최종 스키마로 prisma db push + generate
- [ ] /api/health 엔드포인트 확인

#### 2–3주차: 핵심 페이지 (읽기 전용)
- [ ] 아티스트 페이지 — `/ko/artists/[id]/[slug]`
  - 아티스트 이름 + 소개
  - 서브유닛 목록
  - 이벤트 히스토리 (EventSeries + Event 목록)
- [ ] 곡 페이지 — `/ko/songs/[id]/[slug]`
  - 곡 정보 + 번역
  - 공연 히스토리 (어느 이벤트, 몇 번째 위치)
  - 변형 목록 (SAKURA Ver. 등)
- [ ] 이벤트 페이지 — `/ko/events/[id]/[slug]`
  - 이벤트 정보 (장소, 날짜, 상태)
  - 유닛/멤버 정보 포함 전체 셋리스트
  - EventSeries 브레드크럼
- [ ] EventSeries 페이지 — `/ko/series/[id]/[slug]`
  - 시리즈 개요
  - 전체 이벤트 목록 (parentEventId 있으면 레그별 그룹화)

#### 3–4주차: 검색
- [ ] pg_tsvector 전체 텍스트 검색 설정
- [ ] 검색 페이지 — `/ko/search?q=하나무스비`
  - 결과: 곡, 아티스트, 이벤트

#### 4–6주차: 관리자 데이터 입력
- [ ] 관리자 로그인 (하드코딩된 자격증명, 아직 NextAuth 아님)
- [ ] 관리자 페이지: Artist, Song, Event, EventSeries 생성/편집
- [ ] SetlistItem 입력 폼:
  - 곡 선택기 (검색/자동완성)
  - 공연자용 StageIdentity 다중 선택
  - stageType + unitName + note + status 필드
- [ ] 하스노소라 전체 라이브 시드 (운영자가 가장 잘 아는 것부터)
- [ ] 우마무스메 라이브 시드
- [ ] 학원아이돌마스터 1st Live 시드

#### 출시 전
- [ ] 개인정보처리방침 (termly.io 또는 iubenda — CCPA + GDPR + PIPA)
- [ ] Naver 서치어드바이저 (HTML 파일을 /public에)
- [ ] 세 IP 모두 DC인사이드 갤러리 아웃리치

---

### Phase 1B — 기여 시스템 (2–4주)
**목표:** 신뢰할 수 있는 유저들이 데이터를 기여할 수 있도록.

- [ ] NextAuth.js — Google + Kakao 로그인
- [ ] 유저 프로필 페이지
- [ ] 기여 폼 — 새 SetlistItem 제안 / 기존 편집
- [ ] 신뢰 시스템:
  - 신규 유저: 편집은 관리자 승인 필요
  - 신뢰 유저 (10개+ 승인): 자동 승인
  - 모더레이터: 다른 사람의 편집 승인/거부 가능
- [ ] 편집 히스토리 — 모든 변경의 어펜드 전용 로그
- [ ] 상위 기여자 배지 + 리더보드
- [ ] 기본 2단계 댓글 (롤업 아직 없음)
- [ ] Meilisearch Cloud 설정 (pg_tsvector 대체)
- [ ] 일일 Meilisearch 덤프 → Cloudflare R2 백업

---

### Phase 2 — 성장 및 수익화 (2–3개월)
**목표:** 수익 + 커뮤니티 기능.

- [ ] 댓글 롤업 앤세스트리 시스템 (6개 GIN 인덱스 배열)
- [ ] "번역 보기" 지연 번역 버튼
  - ko↔ja: Papago
  - 기타: DeepL
  - CommentTranslation에 캐시
- [ ] 스팸 방지 (Rate limit + 욕설 필터)
- [ ] Group.hasBoard 자동 추천 (댓글 볼륨 임계값)
- [ ] Kakao AdFit — adfit.kakao.com에서 신청 (한국 전화 준비됨)
- [ ] Google AdSense — EIN + 개인정보처리방침 필요
- [ ] CDJapan 제휴 — cdj.affiliate.net (EIN 필요)
- [ ] Amazon Associates US (JP + KR 커버) — EIN 필요
- [ ] Supabase Pro 티어 (~$25/월, 무료 티어 한계 시)
- [ ] TOS 포함 사용자 이미지 업로드 → Cloudflare R2
- [ ] 일본어 UI + Kuromoji 검색 토크나이저

---

### Phase 3 — 글로벌 확장 (3개월+)
**목표:** 중국 + 영어 시장, 라이브 이벤트 기능.

- [ ] 영어 UI
- [ ] 중국어(간체) UI + Jieba 토크나이저
- [ ] HK 미러 (Alibaba Cloud HK, ~$15/월)
- [ ] 바이두 사이트맵 제출
- [ ] 빌리빌리 커뮤니티 아웃리치
- [ ] ja→zh-CN용 Tencent Cloud MT
- [ ] 중국 트래픽용 百度联盟 광고
- [ ] Supabase Realtime (라이브 이벤트 모드)
- [ ] 비용 정당화 시 Vultr 자체 호스팅 Meilisearch
- [ ] 공개 API (읽기 전용, 속도 제한)

---

## 폴더 구조

```
opensetlist/
├── prisma/
│   ├── schema.prisma          ← 최종 v9 스키마 (634줄)
│   └── migrations/
├── prisma.config.ts           ← Prisma 7 설정 (DB URL이 여기에)
├── src/
│   ├── app/
│   │   ├── [locale]/          ← next-intl 라우팅
│   │   │   ├── page.tsx       ← 홈 페이지
│   │   │   ├── artists/[id]/[[...slug]]/page.tsx
│   │   │   ├── songs/[id]/[[...slug]]/page.tsx
│   │   │   ├── events/[id]/[[...slug]]/page.tsx
│   │   │   ├── series/[id]/[[...slug]]/page.tsx
│   │   │   └── search/page.tsx
│   │   ├── api/
│   │   │   ├── health/route.ts
│   │   │   └── admin/
│   │   └── admin/             ← Phase 1A 관리자 UI
│   ├── generated/prisma/      ← Prisma 클라이언트 출력
│   ├── lib/prisma.ts          ← 싱글톤 클라이언트
│   ├── components/
│   ├── i18n/messages/ko.json
│   └── types/
└── .env.local
```

---

## 환경 변수

```env
# 데이터베이스 (Supabase)
DATABASE_URL="postgresql://postgres.[ref]:[pw]@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres"
DATABASE_URL_UNPOOLED="postgresql://postgres.[ref]:[pw]@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres"

# 인증 (Phase 1B)
NEXTAUTH_URL="https://opensetlist.com"
NEXTAUTH_SECRET="..."
GOOGLE_CLIENT_ID="..."
GOOGLE_CLIENT_SECRET="..."
KAKAO_CLIENT_ID="..."
KAKAO_CLIENT_SECRET="..."

# Redis (Phase 2)
UPSTASH_REDIS_URL="..."
UPSTASH_REDIS_TOKEN="..."

# Cloudflare R2 (Phase 2)
R2_ACCOUNT_ID="..."
R2_ACCESS_KEY_ID="..."
R2_SECRET_ACCESS_KEY="..."
R2_BUCKET_NAME="opensetlist-media"

# 번역 API (Phase 2)
PAPAGO_CLIENT_ID="..."
PAPAGO_CLIENT_SECRET="..."
DEEPL_API_KEY="..."

# Meilisearch (Phase 1B)
MEILISEARCH_HOST="..."
MEILISEARCH_API_KEY="..."

# 관리자 (Phase 1A — 임시)
ADMIN_PASSWORD="..."
```

---

## 수익화

### Phase 2 — 광고
- **Kakao AdFit** — 한국 유저, adfit.kakao.com에서 신청, 한국 전화 + Kakao Bank 준비됨
- **Google AdSense** — 모든 유저, EIN + 개인정보처리방침 필요

### Phase 2 — 제휴
- **CDJapan** — 주력 (블루레이, 앨범, 굿즈) — EIN 필요
- **Amazon Associates US** — 보조 (JP + KR 커버) — EIN 필요

### Phase 3 — 중국
- **百度联盟** — HK 미러 경유 중국 트래픽

---

## 법적 사항 및 운영

### 운영자 정보
- 위치: 미국 캘리포니아 서니베일
- 한국 전화: 보유 (Kakao AdFit용)
- Kakao Bank: 보유 (한국 결제용)
- EIN: 발급 대기 (IRS 1-800-829-4933, 화~목 오전 7~9시 PT)

### 개인정보처리방침
AdSense 전에 필수. CCPA + GDPR + PIPA 커버.
termly.io 또는 iubenda.com 사용.

### Twitter/X 참고
@opensetlist는 죽은 스쿼터 계정 — X의 비활성 계정 요청 프로세스가 2022년 이후 작동 안 함.
공식 핸들로 @opensetlistdb 사용. @opensetlist 정리 모니터링.

---

## 전문가 피드백 요약

두 건의 전문가 리뷰 수령. 검증된 핵심 포인트:
- 스키마 설계: "탁월함" — Translation 패턴, 롤업 앤세스트리, time-aware VA 추적, 메들리 지원
- 댓글 롤업 아키텍처: "정말 훌륭함" (한 리뷰어)
- 중국/HK 미러 전략: "현실적이고 효과적"
- CDJapan 제휴 모델: "유저베이스에 완벽히 맞음"

피드백 기반 주요 변경사항:
- Phase 1A 범위 대폭 축소 (광고, Meilisearch, 한국어 외 i18n 없음)
- 검색: pg_tsvector → Meilisearch Cloud → 자체 호스팅 순서
- 번역: 자동이 아닌 지연 (사용자 요청)
- 시드 데이터: 운영자 검증 3개 IP (Love Live!, 우마무스메, 학원아이돌마스터)
- URL 슬러그: 숫자 ID 표준형, 지금 결정
- 공개 URL 테이블에 BigInt ID (Artist, Song, Event, EventSeries, SetlistItem)
- 핵심 콘텐츠 테이블에 소프트 삭제 (isDeleted + deletedAt)
- 모든 고정값 문자열 필드에 열거형 (타입 안전성 + DB 제약)
- 모든 롤업 배열 필드에 GIN 인덱스
- Meilisearch: 재해 복구를 위한 일일 R2 백업
- 세 IP 모두 DC인사이드 갤러리에서 출시 전 커뮤니티 아웃리치
