/** A sorted copy of the items, by the first key, then by the next one where
 * the first is the same, and so on. Numbers sort from low to high and strings
 * by their characters' codes ("B" before "a"); items with the same keys keep
 * their order. */
export function sortBy<T>(
  items: readonly T[],
  ...keys: ((item: T) => number | string)[]
): T[] {
  return [...items].sort((a, b) => {
    for (const key of keys) {
      const x = key(a);
      const y = key(b);
      if (x < y) return -1;
      if (x > y) return 1;
    }
    return 0;
  });
}
