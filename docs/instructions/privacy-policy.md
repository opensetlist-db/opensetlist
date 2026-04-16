# privacy-policy.md — 개인정보처리방침 페이지

> AdFit/AdSense 신청 시 필수.
> 쿠키 사용 고지 포함.
> app/[locale]/privacy/page.tsx 로 구현.

---

## 페이지 구현

```typescript
// app/[locale]/privacy/page.tsx

export default function PrivacyPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 py-12">
      <h1>개인정보처리방침</h1>
      <PrivacyContent />
    </main>
  )
}
```

---

## 한국어 내용

```markdown
# 개인정보처리방침

OpenSetlist(이하 "서비스")는 이용자의 개인정보를 중요시하며,
「개인정보 보호법」을 준수합니다.

최종 수정일: 2026년 5월 2일

## 1. 수집하는 개인정보

서비스는 다음과 같은 정보를 수집합니다:

**자동 수집 정보**
- 방문 기록, IP 주소, 쿠키
- 브라우저 종류, 운영체제
- 방문 페이지, 체류 시간

**회원 가입 시 (Phase 2 이후)**
- 이메일 주소
- 닉네임

## 2. 개인정보 수집 및 이용 목적

- 서비스 제공 및 개선
- 방문자 통계 분석 (Google Analytics)
- 광고 게재 (Google AdSense, Kakao AdFit)

## 3. 쿠키(Cookie) 사용

서비스는 다음 목적으로 쿠키를 사용합니다:

- Google Analytics: 방문자 통계 분석
- Google AdSense: 맞춤형 광고 제공
- Kakao AdFit: 맞춤형 광고 제공

브라우저 설정에서 쿠키를 거부할 수 있으나,
일부 서비스 이용이 제한될 수 있습니다.

## 4. 제3자 제공

수집한 개인정보는 원칙적으로 제3자에게 제공하지 않습니다.
단, 아래의 경우는 예외입니다:

- Google Analytics (방문자 분석)
- Google AdSense (광고 서비스)
- Kakao AdFit (광고 서비스)

## 5. 개인정보 보유 기간

- 서비스 이용 기간 동안 보유
- 회원 탈퇴 시 즉시 삭제
- 법령에 의한 보존 의무가 있는 경우 해당 기간 보유

## 6. 이용자 권리

이용자는 언제든지 다음 권리를 행사할 수 있습니다:
- 개인정보 열람 요청
- 개인정보 수정 요청
- 개인정보 삭제 요청
- 개인정보 처리 정지 요청

## 7. 문의

개인정보 관련 문의:
이메일: hello.opensetlist@gmail.com
```

---

## 영어 내용 (en)

```markdown
# Privacy Policy

Last updated: May 2, 2026

## Information We Collect

**Automatically collected:**
- Visit logs, IP address, cookies
- Browser type, operating system
- Pages visited, time spent

**On registration (Phase 2):**
- Email address
- Username

## How We Use Information

- Provide and improve the service
- Visitor analytics (Google Analytics)
- Advertising (Google AdSense, Kakao AdFit)

## Cookies

We use cookies for:
- Google Analytics: visitor statistics
- Google AdSense: personalized ads
- Kakao AdFit: personalized ads

You can disable cookies in your browser settings.

## Third Parties

We share data with:
- Google Analytics
- Google AdSense
- Kakao AdFit

## Contact

hello.opensetlist@gmail.com
```

---

## 이용약관 (Terms of Service)

```typescript
// app/[locale]/terms/page.tsx
```

```markdown
# 이용약관

최종 수정일: 2026년 5월 2일

## 1. 서비스 소개

OpenSetlist는 애니메이션/게임 라이브 공연의
셋리스트 정보를 제공하는 커뮤니티 데이터베이스입니다.

## 2. 이용 조건

- 서비스는 무료로 제공됩니다
- 상업적 목적의 데이터 수집/재배포를 금지합니다
- 허위 정보 입력을 금지합니다

## 3. 저작권

- 서비스의 UI/디자인 저작권은 OpenSetlist에 있습니다
- 공연 정보/셋리스트는 팬 커뮤니티가 수집한 정보입니다
- 음악 저작권은 각 권리자에게 있습니다

## 4. 면책 조항

- 셋리스트 정보의 정확성을 보장하지 않습니다
- 서비스 중단으로 인한 손해에 책임지지 않습니다

## 5. 문의

hello.opensetlist@gmail.com
```

---

## 푸터에 링크 추가

```typescript
// components/Footer.tsx

export default function Footer() {
  return (
    <footer>
      <div>
        <a href="/ko/privacy">개인정보처리방침</a>
        <span> · </span>
        <a href="/ko/terms">이용약관</a>
        <span> · </span>
        <a href="mailto:hello.opensetlist@gmail.com">문의</a>
      </div>
      <div>
        © 2026 OpenSetlist
      </div>
    </footer>
  )
}
```

---

## Steps for ClaudeCode

```
1. app/[locale]/privacy/page.tsx 생성
   한국어/영어 내용 포함

2. app/[locale]/terms/page.tsx 생성
   한국어/영어 내용 포함

3. Footer 컴포넌트에 링크 추가:
   개인정보처리방침 · 이용약관 · 문의
   hello.opensetlist@gmail.com

4. sitemap.ts에 추가:
   /ko/privacy
   /ko/terms
```
