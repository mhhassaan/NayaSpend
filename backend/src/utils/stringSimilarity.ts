function bigrams(value: string): string[] {
  if (value.length < 2) return [value];
  const pairs: string[] = [];
  for (let i = 0; i < value.length - 1; i++) {
    pairs.push(value.slice(i, i + 2));
  }
  return pairs;
}

/**
 * Sørensen-Dice coefficient over adjacent-character bigrams, 0-1.
 * Strings shorter than 2 characters fall back to exact-match (1 or 0) to
 * avoid an empty-bigram-set edge case.
 */
export function diceCoefficient(a: string, b: string): number {
  const left = a.toLowerCase();
  const right = b.toLowerCase();

  if (left.length < 2 || right.length < 2) {
    return left === right ? 1 : 0;
  }

  const leftBigrams = bigrams(left);
  const rightBigrams = bigrams(right);

  const rightCounts = new Map<string, number>();
  for (const bigram of rightBigrams) {
    rightCounts.set(bigram, (rightCounts.get(bigram) ?? 0) + 1);
  }

  let intersectionSize = 0;
  for (const bigram of leftBigrams) {
    const remaining = rightCounts.get(bigram) ?? 0;
    if (remaining > 0) {
      intersectionSize++;
      rightCounts.set(bigram, remaining - 1);
    }
  }

  return (2 * intersectionSize) / (leftBigrams.length + rightBigrams.length);
}
