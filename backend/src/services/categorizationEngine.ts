import { CANONICAL_CATEGORIES } from "../../../shared/categories";
import { and, eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { categoryRules } from "../db/schema";

const UNCATEGORIZED = CANONICAL_CATEGORIES[CANONICAL_CATEGORIES.length - 1];

// Explicit transfer descriptions take priority over merchant-like recipient names.
// Word boundaries avoid matches such as "mart" in "smart" or "jazz" in "jazzcash".
const KEYWORD_RULES: { pattern: RegExp; category: (typeof CANONICAL_CATEGORIES)[number] }[] = [
  { pattern: /\b(fund transfer|money received|money sent|raast|ibft|peer[ -]to[ -]peer)\b/, category: CANONICAL_CATEGORIES[0] },
  { pattern: /\b(pharmacyy?|pharmacies|medical store|chemist|hospital|clinic)\b/, category: CANONICAL_CATEGORIES[1] },
  { pattern: /\b(kfc|foodpanda|sweets?|bakery|bakers?|restaurants?|cafe|coffee|biryani|pizza|burgers?|bbq|barbecue|potato factory|mcdonald'?s|bundu khan)\b/, category: CANONICAL_CATEGORIES[2] },
  { pattern: /\b(mart|supermarket|cash (?:and|&) carry|grocer(?:y|ies|s)?|general store)\b/, category: CANONICAL_CATEGORIES[3] },
  { pattern: /\b(m[ -]?tag|gasoline|petrol|fuel|careem|uber|bykea|taxi)\b/, category: CANONICAL_CATEGORIES[4] },
  { pattern: /\b(mobile top[ -]?up|recharge|jazz|zong|ufone|telenor|electricity|gas bill|water bill|internet|wi[ -]?fi|lesco|iesco|k[ -]electric|ptcl|sngpl|ssgc)\b/, category: CANONICAL_CATEGORIES[5] },
];

export function classifyByKeyword(vendorNormalized: string): string | null {
  return KEYWORD_RULES.find(({ pattern }) => pattern.test(vendorNormalized))?.category ?? null;
}

export function normalize(vendor: string): string {
  return vendor.trim().toLowerCase();
}

export async function categorize(
  db: DrizzleD1Database,
  vendorNormalized: string,
  userId: number,
  defaultCategory?: string
): Promise<string> {
  const normalized = normalize(vendorNormalized);
  const [rule] = await db
    .select()
    .from(categoryRules)
    .where(and(eq(categoryRules.userId, userId), eq(categoryRules.vendorNormalized, normalized)));

  return rule?.category ?? defaultCategory ?? classifyByKeyword(normalized) ?? UNCATEGORIZED;
}

export async function correctCategory(
  db: DrizzleD1Database,
  vendorNormalized: string,
  category: string,
  userId: number
): Promise<void> {
  const normalized = normalize(vendorNormalized);
  const [existing] = await db
    .select()
    .from(categoryRules)
    .where(and(eq(categoryRules.userId, userId), eq(categoryRules.vendorNormalized, normalized)));

  if (existing) {
    await db
      .update(categoryRules)
      .set({ category })
      .where(and(eq(categoryRules.userId, userId), eq(categoryRules.vendorNormalized, normalized)));
  } else {
    await db.insert(categoryRules).values({ userId, vendorNormalized: normalized, category });
  }
}
