# 20260413-schema-additions-12.md — Event.startTime 추가

> 희망곡/예상곡 선택 마감 시각 기준으로 사용.
> 공연 시작 시각에 자동 Lock.
> DB는 UTC 저장, 표시는 브라우저 로컬 타임.

---

## 스키마 변경

```prisma
model Event {
  // 기존
  date      DateTime? @db.Date

  // 추가
  startTime DateTime?
  // UTC 기준 저장
  // 예: 2026-05-02T07:30:00Z = 한국/일본 16:30
  // nullable: 시작 시각 모를 경우 기본값 사용
}
```

---

## 마이그레이션

```bash
npx prisma db push
```

---

## events.csv 변경

```csv
slug,date,startTime,...

# startTime은 UTC 또는 +09:00 형식 모두 가능
# Prisma가 자동으로 UTC 변환

bloom-stage-fukuoka-day1,2026-05-02,2026-05-02T07:30:00Z,...
bloom-stage-fukuoka-day2,2026-05-03,2026-05-03T06:00:00Z,...
garden-stage-kobe-day1,2026-05-23,2026-05-23T07:30:00Z,...

# 또는 JST로 입력해도 됨
bloom-stage-fukuoka-day1,2026-05-02,2026-05-02T16:30:00+09:00,...
```

---

## Lock 로직 (phase1-5-implementation.md 반영)

```typescript
// lib/eventUtils.ts

export function getEventLockTime(event: {
  date: Date | null
  startTime: Date | null
}): Date {
  if (event.startTime) {
    return event.startTime  // UTC로 저장되어 있음
  }

  // startTime 없는 경우 기본값: 당일 14:00 KST = 05:00 UTC
  if (event.date) {
    const date = new Date(event.date)
    return new Date(Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      5, 0, 0  // 05:00 UTC = 14:00 KST/JST
    ))
  }

  // date도 없으면 현재 시각 (사실상 항상 locked)
  return new Date()
}

export function isEventLocked(event: {
  date: Date | null
  startTime: Date | null
}): boolean {
  return new Date() > getEventLockTime(event)
}
```

---

## 공연 페이지에서 사용

```typescript
// app/[locale]/events/[slug]/page.tsx

const lockTime = getEventLockTime(event)
const isLocked = isEventLocked(event)

// WishlistSelector에 전달
<WishlistSelector
  eventId={event.id}
  eventStartTime={lockTime}
  isLocked={isLocked}
  ...
/>
```

---

## 시간 표시 (어드민 + 공연 페이지)

```typescript
// 유저에게 표시할 때는 브라우저 로컬 타임으로 변환
// 한국/일본 유저 → 16:30 자동 표시
// 영어권 유저 → 각자 타임존으로 표시

const displayTime = lockTime.toLocaleTimeString(locale, {
  hour: '2-digit',
  minute: '2-digit',
  timeZoneName: 'short',
})

// 예: "16:30 KST" (한국), "16:30 JST" (일본)
```

---

## 체크리스트

```
[ ] Event 스키마에 startTime 추가
[ ] npx prisma db push (dev DB)
[ ] events.csv에 startTime 컬럼 추가
[ ] 기존 이벤트 데이터에 startTime 입력
    (하스노소라 6th Live 각 공연 시작 시각)
[ ] getEventLockTime 유틸 함수 추가
[ ] WishlistSelector에 isLocked 전달
[ ] 어드민에서 startTime 입력 필드 추가
[ ] npx prisma db push (prod DB) ← 태그 생성 시 자동
```
