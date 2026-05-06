import { describe, it, expect } from "vitest";
import {
  calcPredictScore,
  calcShareCardScore,
  type PredictionMatchInput,
} from "@/lib/predictScore";
import type { SongMatchInputItem } from "@/lib/songMatch";

function p(songId: number): PredictionMatchInput {
  return { songId };
}

function actual(
  ...songs: Array<{ id: number; baseVersionId?: number | null }>
): SongMatchInputItem & { id: number } {
  return {
    id: songs[0]?.id ?? 0, // SetlistItem id; share-card uses this for de-dupe
    songs: songs.map((s) => ({
      song: { id: s.id, baseVersionId: s.baseVersionId ?? null },
    })),
  };
}

describe("calcPredictScore (position-rank)", () => {
  it("0 actuals → 0/0 = 0%, no pending", () => {
    const result = calcPredictScore([p(1), p(2)], []);
    expect(result).toEqual({
      matched: 0,
      total: 0,
      percentage: 0,
      pendingSongs: [],
    });
  });

  it("0 predictions → counts no matches", () => {
    const result = calcPredictScore([], [actual({ id: 1 }), actual({ id: 2 })]);
    expect(result.matched).toBe(0);
    expect(result.total).toBe(2);
    expect(result.percentage).toBe(0);
  });

  it("in-rank match counts: predicted at idx 0, actual count is 1", () => {
    // user predicted song 1 at rank 1; song 1 played; matchIndex=0 < total=1 → counts
    const result = calcPredictScore([p(1)], [actual({ id: 1 })]);
    expect(result.matched).toBe(1);
    expect(result.total).toBe(1);
    expect(result.percentage).toBe(100);
    expect(result.pendingSongs).toEqual([]);
  });

  it("out-of-rank match goes to pendingSongs (matchIndex >= total)", () => {
    // user predicted song 50 at rank 5 (idx 4); only 3 actuals so far;
    // matchIndex=4, total=3 → out of rank → pending
    const result = calcPredictScore(
      [p(10), p(20), p(30), p(40), p(50)],
      [actual({ id: 100 }), actual({ id: 200 }), actual({ id: 50 })],
    );
    expect(result.matched).toBe(0);
    expect(result.total).toBe(3);
    expect(result.pendingSongs).toEqual([50]);
  });

  it("mixed in-rank + out-of-rank in the same actual list", () => {
    // Predicted ranks: 10, 20, 30, 40, 50 at idx 0-4
    // Actuals played: 10 (idx 0 in pred → in-rank), 999 (no match), 50 (idx 4 in pred → 4 >= 3? yes → pending)
    const result = calcPredictScore(
      [p(10), p(20), p(30), p(40), p(50)],
      [actual({ id: 10 }), actual({ id: 999 }), actual({ id: 50 })],
    );
    expect(result.matched).toBe(1);
    expect(result.total).toBe(3);
    expect(result.percentage).toBe(33);
    expect(result.pendingSongs).toEqual([50]);
  });

  it("variant via baseVersionId: predicted base hits actual variant", () => {
    // predicted "Dream Believers" id=10; actual "Dream Believers (105th Ver.)"
    // id=11 baseVersionId=10. isSongMatched returns true → counts.
    const result = calcPredictScore(
      [p(10)],
      [actual({ id: 11, baseVersionId: 10 })],
    );
    expect(result.matched).toBe(1);
  });

  it("medley: predicted matches one of the constituents", () => {
    // actual is a medley with songs [1, 50, 99]; user predicted 50 at rank 1
    const result = calcPredictScore(
      [p(50)],
      [actual({ id: 1 }, { id: 50 }, { id: 99 })],
    );
    expect(result.matched).toBe(1);
    expect(result.pendingSongs).toEqual([]);
  });

  it("auto-promotion: out-of-rank pending becomes in-rank as total grows", () => {
    // Predicted rank 5 (idx 4) song 50.
    const predicted = [p(10), p(20), p(30), p(40), p(50)];

    // After 3 actuals, song 50 is pending (idx 4 >= total 3).
    const at3 = calcPredictScore(predicted, [
      actual({ id: 999 }),
      actual({ id: 998 }),
      actual({ id: 50 }),
    ]);
    expect(at3.matched).toBe(0);
    expect(at3.pendingSongs).toEqual([50]);

    // After 5 actuals (one more between), idx 4 < total 5 → counts.
    const at5 = calcPredictScore(predicted, [
      actual({ id: 999 }),
      actual({ id: 998 }),
      actual({ id: 50 }),
      actual({ id: 997 }),
      actual({ id: 996 }),
    ]);
    expect(at5.matched).toBe(1);
    expect(at5.pendingSongs).toEqual([]);
  });

  it("percentage rounds half-up", () => {
    // 1/3 = 33.33...% → 33
    const r1 = calcPredictScore(
      [p(10)],
      [actual({ id: 10 }), actual({ id: 99 }), actual({ id: 98 })],
    );
    expect(r1.percentage).toBe(33);
    // 2/3 = 66.66...% → 67
    const r2 = calcPredictScore(
      [p(10), p(20)],
      [actual({ id: 10 }), actual({ id: 20 }), actual({ id: 99 })],
    );
    expect(r2.percentage).toBe(67);
  });
});

describe("calcShareCardScore (order-independent)", () => {
  it("0 actuals → 0/0 = 0%", () => {
    const result = calcShareCardScore([p(1), p(2)], []);
    expect(result).toEqual({ matched: 0, total: 0, percentage: 0 });
  });

  it("every match counts regardless of predicted rank", () => {
    // Predicted at rank 1, 2, 3. Actuals played: pred[2], pred[0].
    // calcPredictScore would give 1/2 (only idx 0 < total 2 counts because
    // idx 2 >= 2 is out-of-rank). calcShareCardScore counts both.
    const result = calcShareCardScore(
      [p(10), p(20), p(30)],
      [actual({ id: 30 }), actual({ id: 10 })],
    );
    expect(result.matched).toBe(2);
    expect(result.total).toBe(2);
    expect(result.percentage).toBe(100);
  });

  it("variant via baseVersionId still hits", () => {
    const result = calcShareCardScore(
      [p(10)],
      [actual({ id: 11, baseVersionId: 10 })],
    );
    expect(result.matched).toBe(1);
  });

  it("medley constituent still hits", () => {
    const result = calcShareCardScore(
      [p(50)],
      [actual({ id: 1 }, { id: 50 }, { id: 99 })],
    );
    expect(result.matched).toBe(1);
  });

  it("same song twice in actual setlist counts both occurrences (per task spec §22)", () => {
    // Two distinct SetlistItem rows for the same songId both count
    // because the dedup is on actual.id, not songId.
    const result = calcShareCardScore(
      [p(10)],
      [
        { id: 100, songs: [{ song: { id: 10, baseVersionId: null } }] },
        { id: 200, songs: [{ song: { id: 10, baseVersionId: null } }] },
      ],
    );
    expect(result.matched).toBe(2);
    expect(result.total).toBe(2);
  });
});
