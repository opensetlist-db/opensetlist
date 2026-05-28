import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";

/**
 * GET /api/admin/albums
 *
 * Returns every Album row (no soft-delete column on Album as of v0.14.x;
 * if added later, gate `where: { isDeleted: false }` here in lockstep).
 * Used by the admin EventForm's BD Album picker (b07) so the operator
 * can link an Event to its BD Album via a searchable dropdown.
 *
 * Shape kept narrow — just enough for picker display (id, slug, type,
 * release date, original title + locale translations). Heavier album
 * detail (tracks, listings, bonuses) stays on the existing
 * `/api/admin/albums/[id]` endpoint for the per-album edit page.
 *
 * Ordering: `releaseDate desc, createdAt desc` — operator's mental
 * model when picking a BD is "latest album first." Same direction the
 * public album list page sorts.
 *
 * Auth: admin GET endpoints on this project don't run an explicit
 * `verifyAdminAPI` check (see e.g. `/api/admin/event-series`); the
 * `/api/admin/*` paths are server-rendered surfaces accessed only
 * from inside the admin panel, and the cookie/middleware policy
 * protects them at the route boundary. Mirror that convention here.
 *
 * No POST exposed — Album rows come from CSV import, not admin form
 * creation. See the comment on `/api/admin/albums/[id]/route.ts`.
 */
export async function GET() {
  const albums = await prisma.album.findMany({
    select: {
      id: true,
      slug: true,
      type: true,
      releaseDate: true,
      originalTitle: true,
      translations: {
        select: { locale: true, title: true },
      },
    },
    orderBy: [{ releaseDate: "desc" }, { createdAt: "desc" }],
  });
  return NextResponse.json(serializeBigInt(albums));
}
