# CLAUDE.md — 애니/게임 셋리스트 사이트 프로젝트

> 이 파일은 Claude와의 대화에서 결정된 프로젝트 설계 내용을 요약한 것입니다.

---

## 프로젝트 개요

일본 애니/게임 라이브 이벤트에 특화된 셋리스트 데이터베이스 사이트.
setlist.fm과 유사하게, 특정 곡이 어떤 라이브에서 공연됐는지 검색할 수 있는 서비스.

- 1단계 타겟: 한국 유저
- 이후 확장: 일본어, 영어, 중국어(간체) 지원

---

## 기술 스택

| 레이어 | 기술 |
|---|---|
| 프레임워크 | Next.js 14 (App Router) |
| 언어 | TypeScript |
| i18n | next-intl |
| 인증 | NextAuth.js |
| ORM | Prisma 7 |
| DB | PostgreSQL (Supabase) |
| 캐시 | Redis (Upstash — 무료 티어) |
| 검색 | Meilisearch (Vultr Seoul 자체 호스팅) |
| 호스팅 | Vercel (프론트) + Supabase (DB) |
| CDN | Cloudflare (무료) |

---

## 호스팅 & 예산

- **Vultr Seoul 리전** — VPS $6/월 (약 ₩8,500), Meilisearch 호스팅용
- **Supabase** — PostgreSQL 무료 티어로 시작
- **Vercel** — Next.js 무료 티어로 시작
- **도메인** — 가비아 또는 Namecheap (₩10,000–15,000/년)
- **예상 월 비용** — 약 ₩10,000–20,000 (예산 ₩15,000–50,000 이내)
- **Phase 3 추가: HK 미러** — Alibaba Cloud HK 또는 Tencent Cloud HK (~$15/월), ICP 없이 중국에서 VPN 없이 접속 가능

---

## 다국어 (i18n) 설계

### URL 구조
```
/ko/songs/잔혹한-천사의-테제
/ja/songs/残酷な天使のテーゼ
/en/songs/cruel-angel-thesis
/zh-CN/songs/残酷天使的行动纲领
```

### 단계별 언어 출시
1. 한국어 (ko) — 즉시
2. 일본어 (ja) — 6개월 후
3. 영어 (en) — 1년 후
4. 중국어 간체 (zh-CN) — 1.5년 후

### 번역 테이블 패턴
언어별 컬럼 추가 대신 `*Translation` 테이블 분리 방식 사용.
새 언어 추가 시 DB 스키마 변경 없이 행(row)만 추가.

```prisma
model SongTranslation {
  id     String @id @default(uuid())
  songId String
  locale String  // "ko" | "ja" | "en" | "zh-CN"
  title  String
  song   Song   @relation(fields: [songId], references: [id])
  @@unique([songId, locale])
}
```

### 처음부터 반드시 지켜야 할 것들
- 하드코딩 텍스트 절대 금지 → 항상 i18n 키 사용
- 날짜/시간 → 항상 UTC 저장, 표시 시 변환
- 폰트 → Noto Sans 자체 호스팅 (한/중/일/영 모두 지원, Google Fonts 사용 금지)
- URL에 `/[locale]/` 경로 처음부터 포함

---

## 핵심 DB 스키마 (Prisma)

### 테이블 목록

| 테이블 | 역할 |
|---|---|
| `User` | 유저 계정, 선호 언어 |
| `Artist` | 아티스트/성우/그룹 |
| `ArtistTranslation` | 아티스트 다국어 이름/소개 |
| `Song` | 곡 (원어 제목, 원작 애니/게임) |
| `SongTranslation` | 곡 다국어 제목 |
| `Event` | 라이브 이벤트 (`bluRayUrl`, `ticketUrl`, `merchUrl` 제휴 링크 포함) |
| `EventTranslation` | 이벤트 다국어 이름 |
| `Setlist` | 이벤트 × 아티스트 조합 |
| `SetlistItem` | 셋리스트 내 곡 순서 (`position`, `isEncore`) |
| `Comment` | 곡/이벤트 페이지 댓글 (대댓글 지원) |
| `CommentTranslation` | 댓글 번역 캐시 |
| `CommentLike` | 댓글 좋아요 |

### 주요 설계 결정
- `SetlistItem.position` — 공연 순서 정확히 기록
- `SetlistItem.isEncore` — 앙코르 곡 구분
- `Comment.targetType` + `Comment.targetId` — 곡/이벤트 댓글을 단일 테이블로 처리
- `Comment.parentId` — 대댓글 1단계 지원
- `CommentTranslation.@@unique([commentId, targetLocale])` — 번역 캐시, API 중복 호출 방지
- `Event.bluRayUrl` / `Event.ticketUrl` / `Event.merchUrl` — 제휴 링크 필드

---

## 검색

- **엔진**: Meilisearch (한/일/영/중 다국어 지원)
- **검색 대상**: `original_title`, `translations.*.title`, `anime_game_title`
- **일본어**: Kuromoji 토크나이저
- **중국어**: Jieba 토크나이저

---

## 댓글 시스템

- **형태**: YouTube/나무위키 스타일 2단계 댓글 (대댓글 1단계까지)
- **위치**: 각 곡 페이지 하단 + 각 이벤트 페이지 하단
- **실시간**: 없음 (새로고침 방식), 추후 Supabase Realtime으로 업그레이드 가능
- **정렬**: 최신순 / 좋아요순
- **권한**: 로그인한 유저만 작성, 비로그인도 읽기 가능

### 스팸 방지
- Rate limiting: Upstash Ratelimit (1분에 5개 댓글 제한)
- 욕설 필터: `bad-words` 라이브러리
- 신고 기능 (추후)

---

## 다국어 댓글 자동 번역

### 번역 API 조합
| 용도 | API |
|---|---|
| 한국어 ↔ 일본어 | Papago API (품질 최고, 월 10,000자 무료) |
| 그 외 언어 | DeepL API (월 500,000자 무료) |

### 번역 흐름
1. 댓글 작성 시 언어 자동 감지 (`tinyld` 라이브러리)
2. 유저 언어와 다를 경우 번역 캐시(`CommentTranslation`) 확인
3. 캐시 없으면 API 호출 후 DB에 저장
4. UI에서 번역문 기본 표시 + "원문 보기" 토글 제공

---

## 광고 수익화

| 네트워크 | 대상 | 우선순위 |
|---|---|---|
| Kakao AdFit | 한국 유저 | 1순위 |
| Google AdSense | 글로벌 유저 (fallback) | 2순위 |
| Naver GFA | 트래픽 증가 후 | 3순위 |
| 百度联盟 (바이두) | 중국 유저 (Phase 3) | 4순위 |

### 중국 유저 대상 Google 의존성 주의
Google AdSense, Google Fonts, Google Analytics, reCAPTCHA는 중국에서 모두 차단됨.
중국 유저 대상으로는 아래로 대체:
- 광고: 百度联盟 (바이두 연맹)
- 애널리틱스: 자체 호스팅 Umami 또는 百度统计
- 폰트: Noto Sans 자체 호스팅 (처음부터 적용)
- CAPTCHA: Geetest (极验)

---

## 제휴 마케팅 (Affiliate)

셋리스트 사이트는 구매 의도가 높은 유저를 대상으로 하기 때문에 제휴 마케팅 효과가 매우 좋음.
특정 이벤트의 셋리스트를 찾아본 유저는 그 콘서트의 Blu-ray를 살 가능성이 높음.

### 주요 제휴 프로그램
| 프로그램 | 수수료 | 적합 용도 |
|---|---|---|
| CDJapan | 3–8% | Blu-ray, CD, 굿즈 — 가장 적합 |
| Amazon JP | 2–10% | 전체 |
| Amazon KR | 2–6% | 한국 유저 |
| Play-Asia | 5–7% | 게임, 실물 미디어 |
| Apple Music | ~$0.10–0.15/가입 | 음악 스트리밍 추천 |

### 배치 전략
- **이벤트 페이지**: "이 콘서트 Blu-ray 구매" → CDJapan / Amazon JP 제휴 링크
- **곡 페이지**: "듣기" → Apple Music / Spotify 추천 링크
- **예정 이벤트**: "티켓 구매" → eplus / 로손 티켓 링크
- **원작 연계 곡**: 관련 만화, 게임, 스트리밍 링크

### 스키마 추가
```prisma
model Event {
  // ...기존 필드...
  bluRayUrl  String?   // CDJapan 또는 Amazon 제휴 링크
  ticketUrl  String?   // eplus / 로손 티켓 링크
  merchUrl   String?   // 공식 굿즈 스토어 링크
}
```

---

## 중국 유저 전략

### 핵심 문제
만리방화벽(GFW)이 Vercel, Google 서비스, Cloudflare를 중국 내에서 차단함.
중국 애니 팬들은 VPN을 많이 사용하지만, 제대로 지원하려면 추가 작업이 필요.

### 3단계 접근법

| 단계 | 노력 | 시점 |
|---|---|---|
| 아무것도 안 함 — VPN 유저만 접근 가능 | 없음 | Phase 1–2 |
| Alibaba Cloud HK 미러 배포 | 낮음 (1–2일, ~$15/월) | Phase 3 |
| 중국 본토 호스팅 + ICP 신청 | 매우 높음 (수개월, 중국 법인 필요) | 중국 트래픽이 충분할 때만 |

### Phase 3 중국 관련 작업
- [ ] Alibaba Cloud HK 또는 Tencent Cloud HK에 미러 배포
- [ ] Noto Sans 폰트 자체 호스팅 (Google Fonts 의존성 제거)
- [ ] 바이두 사이트맵 제출 (검색 인덱싱)
- [ ] Google Analytics → 자체 호스팅 Umami로 교체
- [ ] 중국 트래픽 대상 百度联盟 광고 추가
- [ ] 빌리빌리(Bilibili) 애니 커뮤니티 아웃리치

### 빌리빌리(Bilibili)가 핵심
중국 애니 팬들은 빌리빌리에서 매우 활발하게 활동함. 인기 빌리빌리 영상에서 한 번 언급되면
수천 명의 중국 유저가 유입될 수 있음. 중국 시장에서는 유료 광고보다 빌리빌리 커뮤니티
참여를 우선시할 것.

---

## 단계별 수익 예측

| 단계 | 월 방문자 | 예상 월 수익 |
|---|---|---|
| Phase 1 — MVP (1–2개월) | 0–500 | ₩0–3,000 |
| Phase 2 — 크라우드소싱 (3–5개월) | 1,000–5,000 | ₩3,000–37,000 |
| Phase 3 — 글로벌 확장 (6–8개월) | 10,000–50,000 | ₩30,000–375,000 |
| 안정화 (1–2년 후) | 100,000–500,000 | ₩350,000–4,250,000 |

제휴 마케팅(CDJapan, Amazon JP) 수익은 규모가 커질수록 광고 수익과 동등하거나 초과할 수 있음.
셋리스트 유저는 콘서트 Blu-ray와 굿즈에 대한 구매 의도가 높기 때문.

---

## 개발 로드맵

### Phase 1 — MVP (1–2개월, 약 6–10주)
- [ ] Supabase PostgreSQL 세팅 + `prisma db push`
- [ ] Next.js 14 프로젝트 초기 세팅 (TypeScript + next-intl)
- [ ] 기본 CRUD — 아티스트/곡/이벤트/셋리스트
- [ ] 곡 검색 기능 (Meilisearch)
- [ ] 기본 UI (한국어만)
- [ ] Kakao AdFit + Google AdSense 연동
- [ ] CDJapan + Amazon 제휴 링크 (이벤트 페이지)
- [ ] Noto Sans 폰트 자체 호스팅

### Phase 2 — 크라우드소싱 (2–3개월, 약 8–12주)
- [ ] NextAuth.js 유저 인증
- [ ] 유저 셋리스트 데이터 기여
- [ ] 수정 히스토리 (Wikipedia식)
- [ ] 2단계 댓글 시스템
- [ ] 댓글 자동 번역 (Papago + DeepL)
- [ ] 스팸 방지 (Rate limit + 욕설 필터)

### Phase 3 — 글로벌 확장 (3개월+, 약 6–10주)
- [ ] 일본어 UI + Kuromoji 토크나이저
- [ ] 영어 UI
- [ ] 중국어(간체) UI + Jieba 토크나이저
- [ ] Alibaba Cloud HK 미러 배포 (~$15/월)
- [ ] 바이두 사이트맵 제출
- [ ] 자체 호스팅 Umami 애널리틱스
- [ ] 百度联盟 광고 연동
- [ ] 빌리빌리 커뮤니티 아웃리치
- [ ] Supabase Realtime 댓글 (선택사항)
- [ ] 공개 API

---

## 환경 변수 (.env)

```env
# DB
DATABASE_URL="postgresql://..."

# 번역
DEEPL_API_KEY=""
PAPAGO_CLIENT_ID=""
PAPAGO_CLIENT_SECRET=""

# 검색
MEILISEARCH_HOST="http://your-vultr-ip:7700"
MEILISEARCH_API_KEY=""

# 캐시
UPSTASH_REDIS_URL=""
UPSTASH_REDIS_TOKEN=""

# 인증
NEXTAUTH_SECRET=""
NEXTAUTH_URL=""

# 광고
KAKAO_ADFIT_ID=""
GOOGLE_ADSENSE_ID=""
BAIDU_UNION_ID=""

# 제휴
CDJA PAN_AFFILIATE_ID=""
AMAZON_JP_AFFILIATE_ID=""
AMAZON_KR_AFFILIATE_ID=""
```

---

## 폴더 구조 (권장)

```
/
├── app/
│   └── [locale]/          ← 언어별 라우팅
│       ├── page.tsx
│       ├── songs/[id]/
│       └── events/[id]/
├── messages/
│   ├── ko.json
│   ├── ja.json
│   ├── en.json
│   └── zh-CN.json
├── public/
│   └── fonts/             ← Noto Sans 자체 호스팅 (Google Fonts 대체)
├── prisma/
│   └── schema.prisma
├── lib/
│   ├── translate.ts       ← Papago + DeepL 번역 로직
│   ├── search.ts          ← Meilisearch 클라이언트
│   └── affiliate.ts       ← 제휴 링크 헬퍼
└── CLAUDE.md              ← 이 파일
```

---

*Generated from Claude conversation — 2026-04-07*

---

## 시작 전 체크리스트

코드를 한 줄도 작성하기 전에 결정하고 준비해야 할 것들.

### 우선순위
```
1. 법적 사항 / 이용약관 + 개인정보처리방침   ← AdSense 승인 필수 요건
2. 초기 데이터 전략                        ← 데이터 없으면 사이트 무의미
3. 도메인 & 브랜딩                         ← 나중에 바꾸기 매우 어려움
4. 애널리틱스 세팅 (Umami)                 ← 처음부터 데이터 수집 필요
5. 커뮤니티 파악                           ← 초기 유저가 누구인지 알아야 함
6. URL 슬러그 전략                         ← 나중에 바꾸기 매우 어려움
7. 이미지 호스팅 (Cloudflare R2)           ← 스키마 설계에 영향
```

---

### 1. 법적 사항 & 저작권

**셋리스트 데이터** — 셋리스트(공연된 곡 목록) 자체는 일반적으로 저작권 보호를 받지 않지만,
일본 엔터테인먼트 회사(Aniplex, Lantis, King Records 등)는 팬 콘텐츠에 공격적인 경우가 있음.
런칭 전에 각 회사 정책을 조사할 것.

**유저 제작 콘텐츠** — 이용약관에서 유저가 제출한 데이터의 정확성에 책임이 있음을 명시하고,
사이트 운영자가 콘텐츠를 삭제할 권리가 있음을 명확히 해야 함.

**제휴 링크 공시** — 한국, 일본 등 대부분의 국가에서 법적으로 필수.
모든 제휴 링크 근처에 눈에 잘 띄는 표시 필요 (예: "이 링크는 제휴 링크입니다").

**개인정보처리방침** — AdSense 승인 필수 조건이며, 아래 법률에 따라 법적으로도 필수:
- 한국: 개인정보보호법 (PIPA)
- 일본: 개인정보보호법 (APPI)
- EU 방문자: GDPR (쿠키 동의 배너 필요)

**GDPR** — EU를 타겟으로 하지 않더라도 유럽 방문자가 있으면 GDPR이 적용됨.
최소한 쿠키 동의 배너 + 개인정보처리방침은 런칭 전에 준비해야 함.

---

### 2. 초기 데이터 전략 (콜드 스타트 문제)

데이터가 없는 셋리스트 사이트는 쓸모가 없음. 비어 있는 사이트에 유저가 데이터를 기여하지 않음.

**런칭 전 데이터 직접 입력** — 특정 분야에 집중해서 먼저 채울 것. 좋은 시작점:
- Animelo Summer Live (수십 년 역사, 한국 팬들에게 인기)
- 특정 아티스트의 전체 라이브 히스토리
- 최근 1–2년간의 주요 이벤트

**데이터 출처** (참고용, 자동 스크래핑 금지):
- 팬 위키 (Fandom, 니코니코 위키, 일본어 팬 위키)
- Twitter/X 팬 스레드
- 유튜브 콘서트 영상 및 댓글
- 일본어 팬 블로그

**크라우드소싱 동기부여** — 유저가 기여할 이유를 만들어야 함:
- 유저 프로필의 기여 횟수 표시
- "이벤트/아티스트 최다 기여자" 뱃지
- 여러 유저가 확인한 셋리스트의 "검증됨" 상태

---

### 3. 도메인 & 브랜딩

- **중립적인 영문 도메인 사용** — 한국, 일본, 중국 유저 모두에게 자연스러움
  (예: `anisetlist.com`, `livedb.net`, `animesetlist.com`)
- **도메인에 아티스트/이벤트명 사용 금지** — 일본에서 상표권 관련 테이크다운 요청을 받을 수 있음
  (예: "animelo", "lantis" 등 포함 금지)
- **소셜 계정 미리 등록** — Twitter/X, Instagram, Bilibili — 런칭 전이라도 브랜드명으로 선점

---

### 4. 애널리틱스 (Umami — 자체 호스팅)

Google Analytics 대신 **Umami** 사용:
- 오픈소스, 자체 호스팅
- GDPR 준수 (기본적으로 쿠키 없음)
- 중국에서 작동 (Google Analytics는 차단됨)
- 무료

**처음부터 추적해야 할 핵심 지표:**
- 언어별 월 활성 유저 (`ko`, `ja`, `en`, `zh-CN`)
- 주간 셋리스트 제출 수 (크라우드소싱 건강 지표)
- 결과 없는 검색 쿼리 (어떤 데이터가 부족한지 파악)
- 곡/이벤트 페이지 이탈률 (콘텐츠 유용성 지표)
- 제휴 링크 유형별 클릭률

---

### 5. 커뮤니티 파악

틈새 사이트의 트래픽은 초기에 SEO보다 커뮤니티에서 옴.
런칭 전에 유저들이 어디 있는지 파악할 것.

| 지역 | 커뮤니티 |
|---|---|
| 한국 | DC인사이드 애니갤, 루리웹, 네이버 카페 애니 게시판 |
| 일본 | Twitter/X 애니 계정들, 5ch, 니코니코 |
| 중국 | 빌리빌리, 웨이보 애니 커뮤니티 |
| 글로벌 | Reddit r/anime, r/japanesemusic |

**빌드 인 퍼블릭** — 런칭 전에 이 커뮤니티들에 개발 진행 상황을 올려서
초기 관심과 첫 기여자를 모을 것.

**모더레이터** — 데이터 품질 관리를 도와줄 신뢰할 수 있는 커뮤니티 멤버를 초기에 모집.
보상 방법 (뱃지, 특별 역할, 사이트 내 크레딧)을 미리 생각해둘 것.

---

### 6. URL 슬러그 전략

빌드 전에 결정 — 검색엔진이 인덱싱한 후에는 변경하기 매우 어려움.

**옵션 A — 숫자 ID** (구현 간단)
```
/en/events/1234
/en/songs/5678
```

**옵션 B — 슬러그** (SEO와 공유에 더 좋음 — 권장)
```
/en/events/animelo-summer-live-2023
/en/songs/cruel-angel-thesis
```

다국어 슬러그는 일본어 원제 슬러그를 정식(canonical) URL로 사용하고
언어별 슬러그는 리다이렉트:
```
/ja/songs/zankoku-na-tenshi-no-these   → canonical (정식 URL)
/ko/songs/잔혹한-천사의-테제            → canonical로 리다이렉트
```

---

### 7. 이미지 호스팅 (Cloudflare R2)

아티스트 사진, 이벤트 포스터는 **Cloudflare R2** 사용:
- 첫 10GB 저장 + 월 100만 요청 무료
- 이그레스 비용 없음 (AWS S3와 달리)
- 글로벌 CDN 내장
- 이미 스택에 있는 Cloudflare와 잘 연동

외부 이미지 URL을 링크하지 말 것 — 시간이 지나면 깨짐.

스키마 추가:
```prisma
model Artist {
  // ...기존 필드...
  imageUrl  String?   // Cloudflare R2 URL
}

model Event {
  // ...기존 필드...
  posterUrl String?   // Cloudflare R2 URL
}
```

---

### 8. SEO (검색엔진 최적화)

SEO = 구글, 네이버, 바이두 등에서 검색 결과 상위에 노출되게 하는 작업.
셋리스트 사이트에서 SEO가 잘 되면 "Animelo 2023 setlist" 검색 시 무료로 유입됨.

**런칭 전 필수 사항:**
- 서버사이드 렌더링 (Next.js 기본 동작 — 셋리스트 데이터를 클라이언트에서 fetch하지 말 것)
- 페이지마다 고유한 `<title>`과 `<meta description>`
- 다국어 페이지의 canonical URL (`<link rel="canonical">`)
- Google Search Console, 네이버 웹마스터도구, 바이두(Phase 3)에 사이트맵 제출

**Open Graph 태그** — Twitter/X나 카카오톡에서 셋리스트 링크를 공유할 때
이벤트명, 날짜, 곡 수가 담긴 미리보기 카드가 보여야 함. 자연스러운 공유를 크게 늘려줌.

```html
<meta property="og:title" content="Animelo Summer Live 2023 셋리스트" />
<meta property="og:description" content="총 42곡 공연 · 2023년 8월 26–27일" />
<meta property="og:image" content="https://r2.yoursite.com/events/animelo-2023-poster.jpg" />
```

**구조화 데이터 (JSON-LD)** — 이벤트 페이지에 `MusicEvent` 스키마 마크업.
구글 검색 결과에서 페이지가 더 잘 표시됨. 런칭 시 필수는 아니지만 Phase 2에서 추가 권장.

**네이버 SEO** — 한국 유저에게는 구글만큼 네이버 검색이 중요함.
네이버 웹마스터도구에 사이트맵을 제출하고 페이지가 서버사이드 렌더링되는지 확인할 것.

---

### 9. 데이터 품질 & 모더레이션

**중복 이벤트** — 유저들이 "Animelo 2023"과 "Animelo Summer Live 2023"을 각각 별개로 만들 수 있음. 해결책:
- 제출 시 엄격한 네이밍 컨벤션 강제
- 중복 항목 병합/리다이렉트 시스템
- 새 이벤트 생성은 관리자 검토 필요

**부정확한 셋리스트** — 잘못된 곡 순서, 누락된 곡, 잘못된 제목. 고려 사항:
- 여러 유저가 확인하면 "검증됨" 상태 부여
- SetlistItem에 출처 필드 추가 (어디서 데이터를 얻었는지)
- 수정 + 롤백 (이미 Phase 2에 계획됨)

**반달리즘** — 틈새 사이트라 위험이 낮지만, 수정 히스토리 (Phase 2 계획에 포함)로 대응 가능.

---

*Generated from Claude conversation — 2026-04-07*

---

## 향후 기능: 앨범 데이터 (Phase 2+)

기존 테이블을 건드리지 않고 추가 가능 — 완전히 additive한 변경.

### 앨범 데이터로 가능해지는 것
- 곡 페이지에서 "원래 수록 앨범 [싱글]" + "이 앨범에도 수록됨 [OST, 베스트앨범]" 표시
- 앨범 페이지에서 전체 트랙리스트 + 각 곡의 셋리스트 히스토리 링크
- 곡/앨범 페이지마다 "이 앨범 구매" 제휴 링크 (CDJapan, Amazon JP)
- 이벤트 페이지에 라이브 앨범 링크
- 추가 SEO 페이지 (앨범/트랙리스트 페이지가 구글, 네이버에 인덱싱됨)

### 스키마 추가 (Phase 2)

```prisma
model Album {
  id           String    @id @default(uuid())
  artistId     String
  releaseDate  DateTime? @db.Date
  labelName    String?
  type         String    // "single" | "album" | "ep" | "live_album" | "soundtrack"
  cdJapanUrl   String?   // 제휴 링크
  amazonUrl    String?   // 제휴 링크
  imageUrl     String?   // Cloudflare R2 — 앨범 아트

  artist       Artist    @relation(fields: [artistId], references: [id])
  translations AlbumTranslation[]
  tracks       AlbumTrack[]
}

model AlbumTranslation {
  id      String @id @default(uuid())
  albumId String
  locale  String
  title   String

  album   Album  @relation(fields: [albumId], references: [id])
  @@unique([albumId, locale])
}

// 다대다 관계: 한 곡이 여러 앨범에 수록될 수 있음
model AlbumTrack {
  id          String @id @default(uuid())
  albumId     String
  songId      String
  trackNumber Int

  album       Album  @relation(fields: [albumId], references: [id])
  song        Song   @relation(fields: [songId], references: [id])
  @@unique([albumId, trackNumber])
}
```

### 핵심 설계 결정
`AlbumTrack`은 junction 테이블 — 한 곡이 여러 앨범에 수록될 수 있기 때문
(원본 싱글, 베스트 컴필레이션, 라이브 앨범, OST 등).
`Song`과 `Album` 사이의 다대다(many-to-many) 관계.

### 앨범 데이터 출처
| 출처 | 설명 |
|---|---|
| **VGMdb** (vgmdb.net) | 가장 적합 — 애니/게임 음악 전문, 트랙리스트 및 레이블 정보 상세 |
| **MusicBrainz** | 오픈 음악 데이터베이스, 일본 음반 정보 풍부 |
| **CDJapan 상품 페이지** | 정확한 발매 정보 + 제휴 링크 소스로 바로 활용 가능 |

VGMdb는 이 사이트가 타겟하는 애니/게임 음악 분야를 전문으로 다루기 때문에
가장 유용한 데이터 출처.

### 도입 계획
```
Phase 1:   앨범 데이터 없음 — 곡 정보만
Phase 2:   prisma migrate로 Album + AlbumTranslation + AlbumTrack 테이블 추가
           인기 곡들 대상으로 VGMdb에서 데이터 시딩
Phase 3+:  제휴 링크가 포함된 앨범 페이지
           곡 페이지에 "앨범 구매" 버튼
           이벤트 페이지에 라이브 앨범 링크
```

---

## 스트레치 골: 애니 음악 너머로 확장 (K-POP, J-POP, C-POP)

setlist.fm은 동아시아에서 거의 인지도가 없음. 지금 만드는 인프라는 이 확장을
대부분 지원함 — 추가 작업은 코드보다 데이터, 커뮤니티, 브랜딩 쪽에서 필요.

### 기존 인프라 활용도
```
그대로 작동:
✅ 다국어 DB 스키마 (ko/ja/en/zh-CN)
✅ 댓글 시스템 + 자동 번역
✅ Meilisearch 다국어 검색
✅ 크라우드소싱 + 수정 히스토리
✅ 중국용 HK 미러
✅ Tour, Member, 유닛 스테이지 스키마 (처음부터 설계)

소규모 확장 필요:
⚠️  Artist.genre 필드 — "kpop" | "jpop" | "cpop" 추가
⚠️  장르별 새 제휴 파트너
⚠️  장르별 새 광고 네트워크

새로운 전략 필요:
🆕  장르별 커뮤니티 전략이 다름
🆕  데이터 소싱 전략 변경
```

### 확장 타임라인
```
Phase 1–3:         애니/게임 음악 — 한국, 일본, 영어, 중국 유저
Phase 4 (스트레치): J-POP — 애니 음악과 자연스럽게 겹침, 같은 아티스트/이벤트
Phase 5 (스트레치): K-POP — 새로운 커뮤니티 전략, 훨씬 큰 시장
Phase 6 (스트레치): C-POP + 동남아 팝
```

### 새로운 제휴 기회
| 플랫폼 | 시장 | 링크 대상 |
|---|---|---|
| 멜론 | 한국 | K-POP 스트리밍 |
| 벅스 | 한국 | K-POP 스트리밍 |
| Yes24 | 한국 | 콘서트 티켓, 앨범 |
| 인터파크 | 한국 | 콘서트 티켓 |
| LINE Music | 일본 | J-POP 스트리밍 |
| mora | 일본 | J-POP 디지털 다운로드 (무손실) |
| Weverse Shop | 글로벌 | K-POP 공식 굿즈 |
| Makestar | 글로벌 | K-POP 앨범 + 팬 프로젝트 |

### 도메인 이름 시사점
`anisetlist.com` 같은 장르 특화 도메인은 K-POP/J-POP 확장의 문을 닫음.
스트레치 골 가능성이 있다면 처음부터 장르 중립 도메인을 선택할 것.
추천: `livesetlist.com`, `encoredb.com`, `setlistdb.net`

---

## 개정된 스키마 설계: Tour, Member, 유닛 스테이지

애니 라이브 이벤트도 이미 유닛 스테이지, 서브그룹 공연, 솔로 스테이지,
멀티레그 투어 등 K-POP 콘서트와 동일한 복잡성을 가짐.
나중에 추가하지 않고 초기 스키마에 설계해 넣음.

### 새로 추가된 테이블

| 테이블 | 역할 |
|---|---|
| `Tour` | 여러 이벤트 날짜를 하나의 투어/시리즈로 묶음 |
| `TourTranslation` | 투어 이름 다국어 |
| `Member` | 그룹 개별 멤버 (아이돌, 유닛, 버추얼 유튜버 등) |
| `MemberTranslation` | 멤버 스테이지명 다국어 |
| `SetlistItemMember` | 각 셋리스트 항목을 누가 공연했는지 |

### SetlistItem 스테이지 타입
```
"full_group"  → 전체 그룹 공연 (기본값, 멤버 행 불필요)
"unit"        → 명칭 있는 서브유닛 (예: "Guilty Kiss", "EXO-CBX", "357")
"solo"        → 개인 솔로 스테이지
"special"     → 게스트, 콜라보, 서프라이즈 스테이지
```

### 실제 사례

**애니 (러브라이브! 선샤인!! 콘서트):**
```
이벤트: Love Live! Sunshine!! WONDERFUL STORIES
  셋리스트:
    1번  — "미숙 DREAMER"           stageType: full_group (Aqours × 9)
    8번  — "Strawberry Trapper"     stageType: unit, unitName: "Guilty Kiss"
                                    performers: [아이다 리카코, 후리하타 아이, 스즈키 아이나]
    14번 — "Omoi yo Hitotsu ni"     stageType: solo
                                    performers: [이나미 안쥬]
```

**K-POP (EXO 콘서트):**
```
이벤트: EXO Planet #5 – EXplOration
  셋리스트:
    1번  — "Power"                  stageType: full_group (EXO × 9)
    11번 — "Sweet Lies"             stageType: unit, unitName: "EXO-CBX"
                                    performers: [백현, 시우민, 첸]
    15번 — "Unfair"                 stageType: solo
                                    performers: [디오]
```

**멀티레그 투어:**
```
투어: Animelo Summer Live 2023
  이벤트: Day 1 — 사이타마 슈퍼 아레나, 2023-08-26
  이벤트: Day 2 — 사이타마 슈퍼 아레나, 2023-08-27

투어: BTS 월드 투어 – Love Yourself
  이벤트: 서울 Day 1 — 올림픽 주경기장, 2018-08-25
  이벤트: 서울 Day 2 — 올림픽 주경기장, 2018-08-26
  이벤트: 로스앤젤레스 — 로즈볼, 2018-09-05
  이벤트: 뉴욕 — 시티 필드, 2018-10-06
```

### 전체 코드는 schema.prisma 참고
수정된 전체 Prisma 스키마는 `prisma/schema.prisma`에 있음.

### Prisma 7 설정 관련 참고사항
Prisma 7 (2025년 11월 출시)은 v6과 비교해 주요 변경사항이 있음:
- DB URL이 `schema.prisma`에서 `prisma.config.ts`로 이동
- Generator에 커스텀 `output` 경로 필수 — 더 이상 `node_modules`에 생성 안 함
- Provider가 `"prisma-client-js"`에서 `"prisma-client"`로 변경
- `PrismaClient`에 드라이버 어댑터(`@prisma/adapter-pg`) 필수
- `db push` 후 `prisma generate`를 별도로 실행해야 함

**prisma.config.ts** (프로젝트 루트):
```typescript
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL_UNPOOLED"),
  },
});
```

**prisma/schema.prisma** generator 블록:
```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
}
```

**PrismaClient 인스턴스화** (src/lib/prisma.ts):
```typescript
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

**.env** (두 개의 URL 필요):
```env
DATABASE_URL="...supabase.co:6543/postgres"          ← 트랜잭션 풀러 (Vercel 런타임)
DATABASE_URL_UNPOOLED="...supabase.co:5432/postgres" ← 직접 연결 (Prisma 마이그레이션)
```

---

## 도메인 & 브랜드: opensetlist.com ✅ 확정

### 도메인
- **opensetlist.com** — Namecheap 또는 Porkbun에서 등록 (~$10–12/년)

### "OpenSetlist"를 선택한 이유
- "Open" → 누구나 접근 가능, 누구나 기여 가능, 커뮤니티 기반임을 암시
- "Setlist" → 사이트가 무엇인지 명확하게 전달 — 모호함 없음
- 한국어(오픈), 일본어(オープン), 영어 모두에서 자연스럽게 발음됨
- K-POP/J-POP 확장에도 장르 중립적으로 사용 가능
- Phase 3 공개 API에 자연스럽게 맞음 (`opensetlist.com/api/v1/`)
- 가장 유사한 실제 사례: OpenStreetMap — 크라우드소싱, 무료, 커뮤니티 소유

### 소셜 핸들 계획
| 플랫폼 | 핸들 | 상태 |
|---|---|---|
| Twitter/X | @opensetlistdb | 영구 핸들 — @opensetlist는 비활성 스쿼터, X 비활성 계정 신청 프로세스 현재 작동 안 함 |
| Instagram | @opensetlist | 사용 가능 — 즉시 등록 |
| Bilibili | @opensetlist | 사용 가능 — 즉시 등록 |
| YouTube | @opensetlistdb | 임시 핸들 — @opensetlist는 무관한 워십 밴드가 사용 중 (398구독, 거의 비활성) |

### Twitter/X 핸들 관련 참고사항
@opensetlist는 비활성 스쿼터 계정 (0포스트, 프로필 사진 없음).
X 비활성 계정 신청 프로세스는 현재 작동하지 않음 (2022년 이후 소유권 변경으로 중단).
@opensetlistdb를 영구 핸들로 사용 — 많은 유명 제품들도 동일하게 운영 (예: @NotionHQ, @LinearApp).
@opensetlist를 주기적으로 모니터링 — 향후 X 계정 정리 시 클레임 가능.

### 등록 순서 (오늘 바로 할 것)
```
1. opensetlist.com          ← 가장 급함
2. Instagram @opensetlist
3. Bilibili @opensetlist
4. YouTube @opensetlistdb
5. Twitter/X 비활성 계정 신청 제출
```

---

## 운영자 정보 & 법적 고려사항

### 위치
- **미국 캘리포니아** 거주
- 한국 전화번호 및 카카오뱅크 계좌 보유 (본인 명의)
- 미국 은행 계좌 보유

### 네트워크별 수익 지급
| 네트워크 | 통화 | 지급 방법 |
|---|---|---|
| Google AdSense | USD | 미국 은행 계좌 (ACH) |
| Amazon JP/KR 제휴 | USD | 미국 은행 계좌 |
| CDJapan 제휴 | USD | PayPal |
| Kakao AdFit | KRW | 카카오뱅크 (직접) |
| Naver GFA | KRW | 카카오뱅크 (직접) |

### 세금 (미국 / 캘리포니아)
- 모든 사이트 수익 (광고, 제휴)은 미국 연방세 + 캘리포니아 주세 과세 대상
- irs.gov에서 무료 **EIN** 발급 — 세금 서류(W-9 등)에 SSN 대신 사용
- 연간 $600 초과 시 광고/제휴 플랫폼이 **1099-NEC** 발송
- 수익의 약 25–30%를 연방세 + 캘리포니아 주세로 별도 보관
- 모든 호스팅/도메인/툴 비용은 **세금 공제 가능** — 영수증 보관
- KRW 수익 (AdFit, Naver)은 수령일 환율로 USD 환산하여 신고 필요

### 사업 구조
| 구조 | 비용 | 시점 |
|---|---|---|
| 개인사업자 (Sole Proprietor) | 무료 | 런칭 시 — 시작하기 좋음 |
| LLC | $70 + 캘리포니아 연간 최소 $800 | 연 수익 $800+ 이후 |

처음에는 개인사업자로 시작. 실제 수익이 생기면 LLC 고려 —
단, 캘리포니아는 연간 최소 $800 프랜차이즈 세금이 있어 그 이상 수익이 날 때만 유리.

### 개인정보처리방침 요건
캘리포니아 거주이므로 아래 세 가지 모두 준수 필요:
- **CCPA** (캘리포니아 소비자 개인정보보호법) — 캘리포니아 유저
- **GDPR** — 유럽 방문자
- **개인정보보호법 (PIPA)** — 한국 유저

**Termly** (termly.io) 또는 **iubenda** (iubenda.com) 사용 — 세 법률 모두 커버.
필수 포함 사항: 데이터 수집 공시, 제3자 공유(광고/애널리틱스), 유저 삭제 권리.

### 한국 서비스 접근
한국 전화번호 + 카카오뱅크로 모든 우회 방법 불필요:

```
Kakao AdFit:    ✅ 한국 전화번호로 인증, 카카오뱅크로 KRW 수령
네이버 서비스:  ✅ 한국 전화번호로 네이버 계정 인증
카카오 계정:    ✅ 한국 전화번호로 완전한 접근
빌리빌리:       ✅ 한국 전화번호로 인증 시도
```

### Kakao AdFit 신청 방법
```
1. adfit.kakao.com 접속
2. 카카오 계정으로 로그인 (한국 전화번호 인증)
3. opensetlist.com 사이트 등록
4. 수익 지급 → 카카오뱅크 계좌번호 입력
5. 승인: 영업일 1–3일
```

### 전체 셋업 체크리스트
```
즉시:
☐ irs.gov에서 EIN 발급 (무료, 약 5분)
☐ 나머지 소셜 계정 (빌리빌리, 유튜브, 트위터/X)
☐ @opensetlist X 계정 주기적으로 모니터링 — 향후 X 계정 삭제 시 클레임

이번 주:
☐ Supabase (리전: Northeast Asia / 서울)
☐ Vercel
☐ Vultr 서울 리전
☐ Upstash Redis (리전: 서울)
☐ GitHub 레포지토리 (지금은 비공개)
☐ Kakao AdFit 신청
☐ 네이버 웹마스터도구 (searchadvisor.naver.com)

수익화 전:
☐ Termly 또는 iubenda로 개인정보처리방침 작성 (CCPA + GDPR + PIPA)
☐ CDJapan 제휴 신청
☐ Amazon Associates US 신청 (JP + KR 링크 모두 커버)
☐ Google AdSense 신청 (사이트에 콘텐츠가 생긴 후)
☐ 수익화 플랫폼 세금 인증용 W-9 서류 준비
```
