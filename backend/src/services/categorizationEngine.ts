import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { categoryRules } from "../db/schema";

const UNCATEGORIZED = "Uncategorized";

function normalize(vendor: string): string {
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

  return rule?.category ?? UNCATEGORIZED;
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
