import type { Prisma } from "@/generated/prisma/client";
import { prisma as defaultDb } from "@/lib/prisma";
import { UploadError, isUploadError } from "./errors";
import { conflictFor, type TargetAdapter } from "./targets";

// Non-upload assignment writes (album cover URL edit / unlink) with the
// same outcome vocabulary as the upload service:
//
//   - the CAS write runs inside one interactive transaction; zero rows
//     updated → `conflictFor` (404 gone / 409 with the current value);
//   - an error while the callback runs means Prisma never sent COMMIT →
//     `not_saved`, the previous assignment is intact;
//   - an error after the callback finished (COMMIT failed, or its reply
//     was lost) may or may not have committed → `outcome_unknown`. The
//     form then re-reads the target instead of claiming failure.
//
// Unlike an upload there is no attempt id to resubmit: a second identical
// CAS after a lost commit would compare against a value that has already
// moved and report a conflict. The client therefore resolves an unknown
// outcome by reading, not by retrying blindly.

type Tx = Prisma.TransactionClient;
export type AssignmentDb = Pick<typeof defaultDb, "$transaction">;

/**
 * Runs `write` (a CAS returning whether it matched) and returns the
 * target's value as committed. Throws UploadError on every failure.
 */
export async function writeAssignment<E>(
  target: TargetAdapter<E>,
  write: (tx: Tx) => Promise<boolean>,
  db: AssignmentDb = defaultDb,
): Promise<E> {
  let callbackFinished = false;
  try {
    return await db.$transaction(async (tx) => {
      if (!(await write(tx))) throw await conflictFor(tx, target);
      const after = await target.read(tx);
      // A row that vanished between the CAS and this read inside the same
      // transaction is impossible (the CAS holds the row lock).
      if (!after)
        throw new Error(
          "assignment target vanished inside its own transaction",
        );
      callbackFinished = true;
      return after;
    });
  } catch (err) {
    if (isUploadError(err)) throw err;
    if (callbackFinished) {
      throw new UploadError(
        "outcome_unknown",
        "저장 결과를 확인하지 못했습니다. 현재 상태를 확인한 뒤 다음 동작을 선택해 주세요.",
        { cause: err },
      );
    }
    throw new UploadError(
      "not_saved",
      "데이터베이스 저장에 실패했습니다. 기존 이미지는 그대로입니다. 잠시 후 다시 시도해 주세요.",
      { cause: err },
    );
  }
}
