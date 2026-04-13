# community-features.md — Community & Engagement Features Roadmap

> Three community features designed to make OpenSetlist more than a setlist database.
> Goal: Create engagement loops that bring fans back before, during, and after each live event.
> These features address the core challenge: why would fans post comments on OpenSetlist
> instead of their familiar communities (DC인사이드, Twitter)?

---

## Overview

```
공연 3주 전:  희망 셋리스트 투표 오픈 (Feature 1)
              셋리스트 예상 게임 오픈 (Feature 3)

공연 당일:    예상 마감 (공연 시작 시각 자동)
              관리자 실시간 셋리스트 입력
              → 실시간 적중률 업데이트 (Feature 3)
              → 곡별 반응 실시간 (Feature 2)

공연 종료 후: 최종 스코어 확정 + 리더보드 (Feature 3)
              화제의 곡 TOP3 발표 (Feature 2)
              희망 곡 중 몇 곡 나왔나 자동 집계 (Feature 1)
```

---

## Feature 1 — 희망 셋리스트 투표

### Background

```
라이브 커뮤니티에는 "이 곡 제발 나와줘" 문화가 있음.
스리즈부케의 잔양(残陽)이 대표적 예:
  오랫동안 라이브에서 불리지 않았던 곡
  나무위키에 "라이브 미수록" 역사가 기록될 정도
  팬들이 라이브 전마다 기대했다가 실망 반복
  → 드디어 나왔을 때 커뮤니티 폭발

이런 곡이 IP마다 존재함.
투표 시스템으로 이 문화를 공식화.
```

### 기능 설명

```
투표 단위: 투어(EventSeries) 단위로 1회
  "하스노소라 6th Live에서 듣고 싶은 곡 TOP5 선택"

오픈 시점: 투어 첫 공연 3주 전
마감 시점: 투어 마지막 공연 종료 후

결과 표시:
  희망 곡 랭킹 (실시간 업데이트)
  각 공연 종료 후: "희망 TOP10 중 N곡 나왔어요" 자동 집계
  투어 전체 종료 후: "팬들이 가장 원했던 곡 중 나온 곡/못 나온 곡" 요약
```

### 데이터 가치

```
"하스노소라 팬이 가장 원하는 곡 TOP10"
→ 미디어/아티스트/제작사에게 유용한 데이터
→ 사이트가 유명해지면 아티스트가 참고할 수 있음
```

### Schema (Phase 2)

```prisma
model SetlistWishVote {
  id            BigInt   @id @default(autoincrement())
  eventSeriesId BigInt
  songId        BigInt
  userId        String   // User.id
  createdAt     DateTime @default(now())

  eventSeries   EventSeries @relation(...)
  song          Song        @relation(...)
  user          User        @relation(...)

  @@unique([eventSeriesId, songId, userId])  // 1인 1곡 1투표
  @@index([eventSeriesId, songId])
}
```

---

## Feature 2 — 화제의 곡 (반응 시스템)

### Background

```
각 라이브마다 화제가 되는 곡이 있음.
잔양처럼 오랫동안 못 나온 곡이 나왔을 때,
또는 깜짝 신곡, 특별 게스트 등.
코멘트/반응이 폭발하는 곡 = 화제의 곡.
```

### 기능 설명

```
셋리스트 각 곡에 반응 버튼:
  😭 기다렸어  (오래 기다린 곡이 나왔을 때)
  🔥 최고      (공연이 특히 좋았을 때)
  😱 깜짝      (예상 못한 곡)
  💙 감동      (감정적인 순간)

로그인 없이도 반응 가능 (IP 기반 중복 방지)
코멘트도 선택적으로 달 수 있음

화제의 곡 선정:
  반응 수 + 코멘트 수 합산
  공연 종료 후 TOP3 자동 선정
  공연 페이지 상단에 "이번 공연 화제의 곡 🔥" 섹션 표시
```

### 표시 예시

```
[이번 공연 화제의 곡]
🥇 残陽  😭 1,204  🔥 892  "드디어 나왔다..."
🥈 Dream Believers (SAKURA Ver.)  😱 567
🥉 ハナムスビ  💙 423
```

### Schema (Phase 2)

```prisma
model SetlistItemReaction {
  id            BigInt   @id @default(autoincrement())
  setlistItemId BigInt
  reactionType  String   // "waiting" | "best" | "surprise" | "moved"
  userId        String?  // null = 비로그인
  ipHash        String?  // 중복 방지용
  createdAt     DateTime @default(now())

  setlistItem   SetlistItem @relation(...)

  @@index([setlistItemId, reactionType])
}

model SetlistItemComment {
  id            BigInt   @id @default(autoincrement())
  setlistItemId BigInt
  userId        String
  content       String
  createdAt     DateTime @default(now())

  setlistItem   SetlistItem @relation(...)
  user          User        @relation(...)

  @@index([setlistItemId])
}
```

---

## Feature 3 — 셋리스트 예상 게임 (핵심 차별점)

### Background

```
아이마스/러브라이브 라이브 전 셋리스트 맞추기는
관련 유튜버들의 인기 주제.

기존 방식의 한계:
  유튜버/팬이 텍스트로 예상 공유
  → 비교/검증이 어려움
  → 기록이 남지 않음
  → 자랑할 수 없음

OpenSetlist:
  시스템이 예상을 받고 자동 채점
  → 실시간 적중률
  → 유저 기록으로 영구 보존
  → 리더보드로 경쟁
  → "나 이번에 23/27 맞췄어!" 자랑 → SNS 바이럴
```

### Phase 2 — 기본 모드 (순서 없음)

```
입력:
  공연 시작 시각 전까지 최대 30곡 선택
  곡 순서 없음 (나올 것 같은 곡만 선택)
  변경 가능 (마감: 공연 시작 시각 자동)
  마감 후 추가/변경 불가

채점:
  공연 종료 후 실제 셋리스트 기준
  내가 선택한 곡 중 실제로 나온 곡 수 / 실제 총 곡 수
  예: 실제 27곡, 내 선택 30곡 중 20곡 적중 → 74%

실시간:
  관리자가 공연 중 곡 입력할 때마다
  → 유저별 "현재 N곡 적중" 실시간 업데이트
  → 공연 보면서 사이트도 같이 보게 되는 효과
```

### Phase 3 — 보너스 모드 추가 (순서 일부 포함)

```
왜 완전한 순서 모드는 어려운가:
  공연에 몇 곡이 나올지 사전에 알 수 없음
  "27번 곡 예상"은 총 27곡이어야 의미 있음
  → 절대적 순서 예상은 불가

해결책 — 오프닝/피날레만:
  기본 모드 (순서 없음) 유지
  + 보너스 질문 2개:
    "오프닝 1번 곡 예상" → 맞으면 +보너스 점수
    "피날레 마지막 곡 예상" → 맞으면 +보너스 점수

왜 이 두 곡만:
  오프닝과 피날레는 팬들이 가장 많이 이야기하는 주제
  총 곡 수와 무관하게 채점 가능
  "오프닝 Dream Believers냐 ハナムスビ냐" 는
  라이브 전 커뮤니티 단골 토론 주제

힌트 제공 (데이터 쌓이면):
  "이 투어 평균 곡 수: 27곡"
  → 과거 공연 데이터 자동 계산
  → 예상에 참고할 수 있음
```

### 리더보드

```
공연별 리더보드:
  "후쿠오카 Day1 예상왕: OOO (96% 적중)"

투어별 누적:
  투어 전 공연 합산 스코어
  "6th Live 투어 예상왕"

전체 누적 (시즌):
  모든 공연 누적
  "OpenSetlist 올해의 예상왕" 뱃지
```

### 유저 프로필

```
공연별 적중률 히스토리:
  후쿠오카 Day1: 74% (20/27)
  후쿠오카 Day2: 81% (22/27)
  고베 Day1: 67% (18/27)

통계:
  평균 적중률
  최고 적중률
  총 참여 공연 수
  오프닝 적중률 / 피날레 적중률

뱃지:
  80% 이상: 🎯 예상의 신
  오프닝 5회 연속 적중: 🎬 오프닝 마스터
```

### Schema (Phase 2)

```prisma
model SetlistPrediction {
  id        BigInt   @id @default(autoincrement())
  eventId   BigInt
  userId    String
  lockedAt  DateTime?  // 공연 시작 시각에 자동 lock
  score     Float?     // 공연 후 채점 결과 (0.0~1.0)
  createdAt DateTime   @default(now())
  updatedAt DateTime   @updatedAt

  event     Event    @relation(...)
  user      User     @relation(...)
  songs     SetlistPredictionSong[]

  @@unique([eventId, userId])
  @@index([eventId])
  @@index([userId])
}

model SetlistPredictionSong {
  predictionId BigInt
  songId       BigInt

  prediction   SetlistPrediction @relation(...)
  song         Song              @relation(...)

  @@unique([predictionId, songId])
}

model SetlistPredictionBonus {
  predictionId  BigInt   @id
  openingSongId BigInt?  // 오프닝 1곡 예상
  finaleSongId  BigInt?  // 피날레 1곡 예상

  prediction    SetlistPrediction @relation(...)
  openingSong   Song?             @relation("OpeningBonus", ...)
  finaleSong    Song?             @relation("FinaleBonus", ...)
}
```

### 채점 로직

```typescript
async function scoreSetlistPrediction(
  predictionId: bigint,
  actualSetlistItems: SetlistItem[]
) {
  const prediction = await prisma.setlistPrediction.findUnique({
    where: { id: predictionId },
    include: { songs: true, bonus: true }
  })

  const actualSongIds = new Set(
    actualSetlistItems.map(item => item.songs[0]?.songId).filter(Boolean)
  )

  // 기본 채점
  const predictedSongIds = prediction.songs.map(s => s.songId)
  const hits = predictedSongIds.filter(id => actualSongIds.has(id)).length
  const baseScore = hits / actualSetlistItems.length  // 실제 총 곡 수 기준

  // 보너스 채점
  let bonusScore = 0
  const firstSong = actualSetlistItems[0]?.songs[0]?.songId
  const lastSong = actualSetlistItems[actualSetlistItems.length - 1]?.songs[0]?.songId

  if (prediction.bonus?.openingSongId === firstSong) bonusScore += 0.1
  if (prediction.bonus?.finaleSongId === lastSong) bonusScore += 0.1

  const finalScore = Math.min(1.0, baseScore + bonusScore)

  await prisma.setlistPrediction.update({
    where: { id: predictionId },
    data: { score: finalScore }
  })

  return finalScore
}
```

---

## Implementation Priority

```
Phase 1 (5/2 런칭):
  없음 — 데이터 입력과 기본 셋리스트 뷰에 집중

Phase 2 (5th Live 고베 5/23 전):
  Feature 2: 반응 버튼 (구현 가장 쉬움)
  Feature 3: 셋리스트 예상 게임 기본 모드
  Feature 1: 희망 셋리스트 투표
  → 유저 인증 시스템 필요 (소셜 로그인)

Phase 3 (6th Live 사이타마 7/11 전):
  Feature 3: 보너스 모드 (오프닝/피날레 예상)
  리더보드 완성
  유저 프로필 통계

Phase 4 (러브라이브 15th 페스 11월 전):
  다른 IP에도 적용
  투어별 시즌 리더보드
  "예상왕" 연간 결산
```

---

## 기대 효과

```
공연 전:
  희망투표 + 예상게임으로 사이트 방문 유도
  커뮤니티 토론 "너는 뭐 골랐어?" → 자연스러운 바이럴

공연 중:
  실시간 적중률 확인 → 공연 보면서 사이트도 체크
  반응 버튼 → DC인사이드 실황 느낌을 사이트에서

공연 후:
  스코어 자랑 → SNS 공유 → 신규 유저 유입
  화제의 곡 → 공연 이슈 정리 콘텐츠

장기:
  데이터 축적 → 의미있는 예측 통계
  "잔양은 언제 나올까" → 희망투표 데이터로 답변
  아티스트/제작사가 팬 니즈 파악에 활용 가능
```
