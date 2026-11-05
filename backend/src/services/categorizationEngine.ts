import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { categoryRules } from "../db/schema";

const UNCATEGORIZED = "Uncategorized";

// Explicit transfer descriptions take priority over merchant-like recipient names.
// Word boundaries avoid matches such as "mart" in "smart" or "jazz" in "jazzcash".
const KEYWORD_RULES: { pattern: RegExp; category: string }[] = [
  { pattern: /\b(fund transfer|money received|money sent|raast|ibft|peer[ -]to[ -]peer)\b/, category: "Transfers" },
  { pattern: /\b(pharmacyy?|pharmacies|medical store|chemist|hospital|clinic)\b/, category: "Health" },
  { pattern: /\b(kfc|foodpanda|sweets?|bakery|bakers?|restaurants?|cafe|coffee|biryani|pizza|burgers?|bbq|barbecue|potato factory|mcdonald'?s|bundu khan)\b/, category: "Food & Dining" },
  { pattern: /\b(mart|supermarket|cash (?:and|&) carry|grocer(?:y|ies|s)?|general store)\b/, category: "Groceries" },
  { pattern: /\b(gasoline|petrol|fuel|careem|uber|bykea|taxi)\b/, category: "Transport" },
  { pattern: /\b(mobile top[ -]?up|recharge|m[ -]?tag|jazz|zong|ufone|telenor|electricity|gas bill|water bill|internet|wi[ -]?fi|lesco|iesco|k[ -]electric|ptcl|sngpl|ssgc)\b/, category: "Utilities" },
];

export function classifyByKeyword(vendorNormalized: string): string | null {
  return KEYWORD_RULES.find(({ pattern }) => pattern.test(vendorNormalized))?.category ?? null;
}

export function normalize(vendor: string): string {
  return vendor.trim().toLowerCase();
}

export async function categorize(
  db: DrizzleD1Database,
  vendorNormalized: string
): Promise<string> {
  const normalized = normalize(vendorNormalized);
  const [rule] = await db
    .select()
    .from(categoryRules)
    .where(eq(categoryRules.vendorNormalized, normalized));

  return rule?.category ?? classifyByKeyword(normalized) ?? UNCATEGORIZED;
}

export async function correctCategory(
  db: DrizzleD1Database,
  vendorNormalized: string,
  category: string
): Promise<void> {
  const normalized = normalize(vendorNormalized);
  const [existing] = await db
    .select()
    .from(categoryRules)
    .where(eq(categoryRules.vendorNormalized, normalized));

  if (existing) {
    await db
      .update(categoryRules)
      .set({ category })
      .where(eq(categoryRules.vendorNormalized, normalized));
  } else {
    await db.insert(categoryRules).values({ vendorNormalized: normalized, category });
  }
}
