/**
 * Validate that all encore items come after all non-encore items.
 * Returns null if valid, or an error message string if invalid.
 */
export function validateEncoreOrder(
  items: { position: number; isEncore: boolean }[]
): string | null {
  const encorePositions = items.filter((i) => i.isEncore).map((i) => i.position);
  const nonEncorePositions = items.filter((i) => !i.isEncore).map((i) => i.position);

  if (encorePositions.length === 0 || nonEncorePositions.length === 0) return null;

  const minEncore = Math.min(...encorePositions);
  const maxNonEncore = Math.max(...nonEncorePositions);

  if (minEncore <= maxNonEncore) {
    return `앙코르 항목(position ${minEncore})이 일반 항목(position ${maxNonEncore}) 앞에 있습니다.`;
  }

  return null;
}
