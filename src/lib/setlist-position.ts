export function nextSetlistPosition(
  items: ReadonlyArray<{ position: number }>,
): number {
  let max = 0;
  for (const item of items) {
    if (item.position > max) max = item.position;
  }
  return max + 1;
}
