# schema-additions-2.md — Translation Dictionary Redesign

> Replaces the TranslationDictionary model defined in schema-additions.md.
> Apply INSTEAD OF the TranslationDictionary section in schema-additions.md.
> All other models in schema-additions.md remain unchanged.

---

## Background

The original single-table TranslationDictionary design has an N² scaling
problem when multiple languages are added:

```
Original design — one row per language pair:
  "직관" ko→ja:    1 row
  "직관" ko→en:    1 row
  "직관" ko→zh-CN: 1 row
  "직관" ko→zh-TW: 1 row
  → Every new language = N more rows per term

Improved design — term-centric:
  DictionaryTerm:        1 row  (the concept + canonical form)
  DictionaryTermSurface: 1 row per language representation
  DictionaryOverride:    only when a specific pair genuinely differs
  → New language = add Surface rows only, terms unchanged
```

User-facing UI stays identical — the complexity is handled by the backend.

---

## Phase strategy

```
Phase 1–2 (ko + ja only):
  One language pair — original design would work fine.
  BUT: implement improved design now to avoid migration later.
  DictionaryOverride table will be empty until Phase 3.

Phase 3+ (4+ languages):
  New languages only require new DictionaryTermSurface rows.
  No schema migration needed.
  UI unchanged.
```

---

## Remove

Delete `TranslationDictionary` model from schema-additions.md.
Replace with the three models below.

---

## New Models

### DictionaryTerm (replaces TranslationDictionary)

```prisma
// The core concept — language-independent.
// canonicalText is what gets sent to the translation API after substitution.
//
// Three usage patterns:
//
// Pattern A — preserve as-is (preserve=true):
//   "링크라", "DOLLCHESTRA", "뇨호호"
//   → canonicalText = sourceText (doesn't matter, API never called)
//   → Translation API is bypassed entirely
//
// Pattern B — expand before translating (preserve=false):
//   "직관" → canonicalText = "직접 관람(직관)"
//   → API receives expanded text, translates correctly
//
// Pattern C — proper noun replacement (preserve=false):
//   "코즈에" → canonicalText = "Kozue Otomari (小豆沢こずえ)"
//   → API sees the full proper noun, handles it correctly

model DictionaryTerm {
  id            String       @id @default(uuid())

  canonicalText String
  // Text sent to translation API after substitution.
  // For preserve=true: value doesn't matter (API not called).

  preserve      Boolean      @default(false)
  // true  → skip translation API, keep original text as-is
  // false → substitute canonicalText, then send to API

  category      DictCategory

  isApproved    Boolean      @default(false)
  // false → applied only for submitting user (trial period)
  // true  → applied for all users globally

  createdBy     String       // userId
  approvedBy    String?      // admin or trusted userId
  useCount      Int          @default(0)
  createdAt     DateTime     @default(now())

  surfaces      DictionaryTermSurface[]
  overrides     DictionaryOverride[]
}
```

### DictionaryTermSurface

```prisma
// One row per language representation of a DictionaryTerm.
// Used to match incoming text to a Term before translation.
//
// Examples for term "Kozue Otomari":
//   locale="ko" text="코즈에"
//   locale="ja" text="こずえ"
//   locale="ja" text="小豆沢こずえ"   ← multiple surfaces per locale OK
//   locale="en" text="Kozue"
//   locale="*"  text="Kozue Otomari"  ← matches any locale
//
// Matching is case-insensitive.

model DictionaryTermSurface {
  id      String @id @default(uuid())
  termId  String
  locale  String
  // "ko" | "ja" | "en" | "zh-CN" | "zh-TW"
  // "*" = matches in any language

  text    String
  // The surface form in this locale.

  term    DictionaryTerm @relation(fields: [termId], references: [id])

  @@unique([termId, locale, text])
  @@index([text, locale])  // fast lookup: does this text have a term?
  @@index([termId])
}
```

### DictionaryOverride

```prisma
// Exception table — only needed when a specific language pair
// requires different output than DictionaryTerm.canonicalText.
//
// Most terms will never have any Override rows.
// Only add when canonicalText gives wrong result for a specific pair.
//
// Example where override is needed:
//   Term: "선생님"
//   canonicalText: "선생님 (teacher/sensei)"
//   Override ko→en: "teacher"   ← drop Japanese nuance for English
//   Override ko→ja: "先生"      ← use Japanese equivalent directly

model DictionaryOverride {
  id           String @id @default(uuid())
  termId       String
  sourceLang   String  // "ko" | "ja" | "en" | "zh-CN" | "zh-TW"
  targetLang   String  // "ko" | "ja" | "en" | "zh-CN" | "zh-TW"
  overrideText String
  // Used instead of DictionaryTerm.canonicalText for this specific pair.

  createdBy    String
  createdAt    DateTime @default(now())

  term         DictionaryTerm @relation(fields: [termId], references: [id])

  @@unique([termId, sourceLang, targetLang])
  @@index([termId])
}
```

---

## Translation pipeline

```typescript
async function applyDictionary(
  text: string,
  sourceLang: string,
  targetLang: string
): Promise<string> {
  // Load all approved surfaces for this sourceLang (+ wildcard)
  const surfaces = await prisma.dictionaryTermSurface.findMany({
    where: {
      locale: { in: [sourceLang, '*'] },
      term: { isApproved: true }
    },
    include: { term: { include: { overrides: true } } }
  })

  let result = text

  for (const surface of surfaces) {
    if (!result.includes(surface.text)) continue

    const term = surface.term

    if (term.preserve) {
      // Pattern A: keep as-is, wrap in placeholder to protect from API
      result = result.replace(surface.text, `__DICT_${term.id}__`)
      continue
    }

    // Check for a specific override for this pair
    const override = term.overrides.find(
      o => o.sourceLang === sourceLang && o.targetLang === targetLang
    )

    const substitution = override?.overrideText ?? term.canonicalText
    result = result.replace(surface.text, substitution)
  }

  // Call translation API with substituted text
  const translated = await callTranslationAPI(result, sourceLang, targetLang)

  // Restore preserved terms from placeholders
  for (const surface of surfaces) {
    if (!surface.term.preserve) continue
    translated = translated.replace(`__DICT_${surface.term.id}__`, surface.text)
  }

  return translated
}
```

---

## User-facing UI (unchanged from original design)

Users see a simple form — the Term/Surface/Override structure is invisible:

```
┌─────────────────────────────────────┐
│ 번역 개선 제안                        │
│                                     │
│ 원문:  [직관          ]  [한국어 ▾]  │
│ 번역:  [직접 관람(직관)]  [English ▾] │
│                                     │
│ ☐ 번역하지 않고 그대로 유지           │
│   (링크라, DOLLCHESTRA 같은 고유어)   │
│                                     │
│ 분류:  [팬덤 용어 ▾]                 │
│ 메모:  [현장 직접 관람을 뜻하는 용어  ]│
│                                     │
│ [제안하기]                           │
└─────────────────────────────────────┘
```

Backend conversion on submit:

```typescript
async function submitDictionaryEntry(input: {
  sourceText: string
  sourceLang: string
  targetText: string
  targetLang: string
  preserve: boolean
  category: DictCategory
  createdBy: string
}) {
  const { sourceText, sourceLang, targetText, targetLang, preserve } = input

  // Check if a Term already exists for this sourceText + locale
  const existingSurface = await prisma.dictionaryTermSurface.findFirst({
    where: { text: sourceText, locale: sourceLang }
  })

  if (existingSurface) {
    // Term exists — check if we need a new Override
    const termId = existingSurface.termId
    const currentCanonical = existingSurface.term.canonicalText

    if (targetText !== currentCanonical) {
      // Different from canonical → add as Override for this specific pair
      await prisma.dictionaryOverride.upsert({
        where: { termId_sourceLang_targetLang: { termId, sourceLang, targetLang } },
        create: { termId, sourceLang, targetLang, overrideText: targetText,
                  createdBy: input.createdBy },
        update: { overrideText: targetText }
      })
    }
    // If same as canonical, no action needed
  } else {
    // New Term — create Term + two Surfaces
    const term = await prisma.dictionaryTerm.create({
      data: {
        canonicalText: preserve ? sourceText : targetText,
        preserve,
        category: input.category,
        isApproved: false,
        createdBy: input.createdBy,
        surfaces: {
          create: [
            { locale: sourceLang, text: sourceText },
            // Add target surface only if different from source
            ...(sourceLang !== targetLang
              ? [{ locale: targetLang, text: targetText }]
              : [])
          ]
        }
      }
    })
  }
}
```

---

## Data examples

### Pattern A — preserve as-is
```
DictionaryTerm:
  canonicalText: "링크라"
  preserve: true
  category: abbreviation

DictionaryTermSurface:
  locale="ko" text="링크라"
  locale="ja" text="リンクラ"
  locale="*"  text="Link Like"

→ Any of these forms in any comment → kept as-is in translation
```

### Pattern B — expand before translating
```
DictionaryTerm:
  canonicalText: "직접 관람(직관)"
  preserve: false
  category: fandom_term

DictionaryTermSurface:
  locale="ko" text="직관"

DictionaryOverride: (none needed)

→ "직관" → "직접 관람(직관)" → API translates → correct result
```

### Pattern C — proper noun
```
DictionaryTerm:
  canonicalText: "Kozue Otomari (小豆沢こずえ)"
  preserve: false
  category: character_name

DictionaryTermSurface:
  locale="ko" text="코즈에"
  locale="ja" text="こずえ"
  locale="ja" text="小豆沢こずえ"
  locale="en" text="Kozue"

DictionaryOverride: (none needed — canonical works for all pairs)
```

### Pattern D — genuine directional difference
```
DictionaryTerm:
  canonicalText: "선생님 (teacher/sensei)"
  preserve: false
  category: fandom_term

DictionaryTermSurface:
  locale="ko" text="선생님"

DictionaryOverride:
  sourceLang="ko" targetLang="en" overrideText="teacher"
  sourceLang="ko" targetLang="ja" overrideText="先生"
```

---

## Steps for ClaudeCode

1. Remove `TranslationDictionary` model (defined in schema-additions.md)
2. Remove `DictCategory` enum temporarily (will re-add in step 3)
3. Add updated `DictCategory` enum (unchanged values, same as before)
4. Add `DictionaryTerm` model
5. Add `DictionaryTermSurface` model
6. Add `DictionaryOverride` model
7. Run `npx prisma db push`
8. Run `npx prisma generate`
9. Verify: `npm run dev` → /api/health → { status: "ok", db: "connected" }
10. Add `applyDictionary()` function to `src/lib/translation.ts`
11. Add `submitDictionaryEntry()` function to `src/lib/translation.ts`
