import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  readCandidates,
  readDecisions,
  reconcile,
  type ExistingListingRow,
  type Decisions,
} from "@/lib/album-bonus-import";
import ReviewClient from "./ReviewClient";

type Props = { params: Promise<{ jobId: string }> };

export default async function ImportReviewJobPage({ params }: Props) {
  const { jobId } = await params;
  const job = await prisma.albumBonusImportJob.findUnique({
    where: { id: jobId },
    include: {
      album: {
        select: {
          id: true,
          originalTitle: true,
          slug: true,
          releaseDate: true,
        },
      },
    },
  });
  if (!job) notFound();

  const candidates = readCandidates(job.candidates);
  const storedDecisions = readDecisions(job.decisions);

  let classifications;
  if (job.albumId) {
    const listings = await prisma.albumStoreListing.findMany({
      where: { albumId: job.albumId },
      select: {
        id: true,
        originalStoreName: true,
        originalEditionLabel: true,
        productUrl: true,
        bonuses: { select: { id: true, originalBonusType: true } },
      },
    });
    classifications = reconcile(candidates, listings as ExistingListingRow[]);
  } else {
    classifications = reconcile(candidates, []);
  }

  // Default-to-approved on first load: missing decision → checked.
  // Operator's typical workflow is "import most, uncheck a few"; the
  // alternative (default-unchecked + click every row) is friction
  // without payoff for an operator-only surface.
  const initialDecisions: Decisions = {
    listings: { ...storedDecisions.listings },
    bonuses: { ...storedDecisions.bonuses },
    globalEarlyBooking: storedDecisions.globalEarlyBooking,
  };
  for (let i = 0; i < candidates.listings.length; i++) {
    if (initialDecisions.listings[i] === undefined) {
      initialDecisions.listings[i] = { approved: true };
    }
    const bonusList = candidates.listings[i].bonuses;
    for (let j = 0; j < bonusList.length; j++) {
      const key = `${i}:${j}`;
      if (initialDecisions.bonuses[key] === undefined) {
        initialDecisions.bonuses[key] = { approved: true };
      }
    }
  }

  // Recent-album picker hint: top 50 most-recently-created albums for
  // a datalist autocomplete. Not exhaustive — operator can type any
  // numeric ID manually. Anything richer (search by title, filter by
  // artist) is out of scope for the MVP review surface.
  const recentAlbums = await prisma.album.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, originalTitle: true, releaseDate: true },
  });

  // Server → client boundary: BigInt fields can't cross. Coerce ids
  // to number explicitly so ReviewClient's prop types stay simple
  // (no bigint reach into "use client" code).
  const jobForClient = {
    id: job.id,
    albumId: job.albumId !== null ? Number(job.albumId) : null,
    sourceUrl: job.sourceUrl,
    notes: job.notes,
    status: job.status,
    createdAt: job.createdAt.toISOString(),
    appliedAt: job.appliedAt ? job.appliedAt.toISOString() : null,
    discardedAt: job.discardedAt ? job.discardedAt.toISOString() : null,
    album: job.album
      ? {
          id: Number(job.album.id),
          originalTitle: job.album.originalTitle,
          slug: job.album.slug,
          releaseDate: job.album.releaseDate
            ? job.album.releaseDate.toISOString()
            : null,
        }
      : null,
  };

  const recentAlbumsForClient = recentAlbums.map((a) => ({
    id: Number(a.id),
    originalTitle: a.originalTitle,
    releaseDate: a.releaseDate ? a.releaseDate.toISOString() : null,
  }));

  return (
    <div>
      <div className="mb-2 text-sm">
        <Link
          href="/admin/album-bonuses/import-review"
          className="text-blue-600 hover:underline"
        >
          ← 임포트 검토 큐
        </Link>
      </div>

      <ReviewClient
        job={jobForClient}
        candidates={candidates}
        classifications={classifications}
        initialDecisions={initialDecisions}
        recentAlbums={recentAlbumsForClient}
      />
    </div>
  );
}
