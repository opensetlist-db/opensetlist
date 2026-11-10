import { parseBigInt } from "@/lib/adminParsers";
import { ALBUM_TYPE_SET } from "@/lib/albumConstants";
import type { AlbumType } from "@/generated/prisma/enums";
import { validateCanonicalSlug } from "@/lib/slug";

export class AlbumInputError extends Error {}

export function parseAlbumInput(body: Record<string, unknown>) {
  let slug: string | undefined;
  if (body.slug !== undefined) {
    if (typeof body.slug !== "string") throw new AlbumInputError("슬러그는 필수입니다.");
    slug = validateCanonicalSlug(body.slug) ?? undefined;
    if (!slug) {
      throw new AlbumInputError("슬러그는 영소문자, 숫자, 하이픈으로만 구성된 URL-safe 형식이어야 합니다.");
    }
  }

  let type: AlbumType | undefined;
  if (body.type !== undefined) {
    if (typeof body.type !== "string" || !ALBUM_TYPE_SET.has(body.type as AlbumType)) {
      throw new AlbumInputError("잘못된 앨범 타입입니다.");
    }
    type = body.type as AlbumType;
  }

  let originalTitle: string | undefined;
  if (body.originalTitle !== undefined) {
    if (typeof body.originalTitle !== "string" || !body.originalTitle.trim()) {
      throw new AlbumInputError("원제는 필수입니다.");
    }
    originalTitle = body.originalTitle.trim();
  }

  let originalLanguage: string | undefined;
  if (body.originalLanguage !== undefined) {
    if (typeof body.originalLanguage !== "string" || !body.originalLanguage.trim()) {
      throw new AlbumInputError("원어를 선택해 주세요.");
    }
    originalLanguage = body.originalLanguage.trim();
  }

  let releaseDate: Date | null | undefined;
  if (body.releaseDate === null || body.releaseDate === "") {
    releaseDate = null;
  } else if (body.releaseDate !== undefined) {
    const raw = body.releaseDate;
    if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      throw new AlbumInputError("발매일 형식이 잘못되었습니다.");
    }
    const parsed = new Date(`${raw}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) {
      throw new AlbumInputError("발매일 형식이 잘못되었습니다.");
    }
    releaseDate = parsed;
  }

  let labelName: string | null | undefined;
  if (body.labelName !== undefined) {
    labelName = typeof body.labelName === "string" ? body.labelName.trim() || null : null;
  }

  let translations: { locale: string; title: string }[] | undefined;
  if (body.translations !== undefined) {
    if (!Array.isArray(body.translations)) {
      throw new AlbumInputError("translations 필드는 배열이어야 합니다.");
    }
    translations = [];
    const seen = new Set<string>();
    for (const row of body.translations) {
      if (!row || typeof row.locale !== "string" || !row.locale.trim() || typeof row.title !== "string") {
        throw new AlbumInputError("앨범 번역 형식이 잘못되었습니다.");
      }
      const locale = row.locale.trim();
      const title = row.title.trim();
      if (seen.has(locale)) throw new AlbumInputError(`중복된 앨범 번역 언어입니다 (${locale}).`);
      seen.add(locale);
      translations.push({ locale, title });
    }
  }

  let artistIds: bigint[] | undefined;
  if (body.artistIds !== undefined) {
    if (!Array.isArray(body.artistIds)) throw new AlbumInputError("아티스트 ID 목록 형식이 잘못되었습니다.");
    const seen = new Set<bigint>();
    for (const value of body.artistIds) {
      const id = parseBigInt(value);
      if (id === null) throw new AlbumInputError("잘못된 아티스트 ID입니다.");
      if (seen.has(id)) throw new AlbumInputError("중복된 아티스트 ID입니다.");
      seen.add(id);
    }
    artistIds = [...seen];
  }

  return { slug, type, originalTitle, originalLanguage, releaseDate, labelName, translations, artistIds };
}
