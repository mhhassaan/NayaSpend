import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import { authIdentities, sessions, transactions, users } from "../src/db/schema";

describe("canonical D1 schema: transactions", () => {
  test("inserting a transaction with integer amount round-trips correctly", async () => {
    const db = drizzle(env.DB);
    const [user] = await db.insert(users).values({
      email: "transaction@example.com",
      displayName: "Transaction User",
      createdAt: "2026-11-01T00:00:00.000Z",
    }).returning();
    await db.insert(transactions).values({
      userId: user.id,
      amount: 1250, // $12.50 in cents
      date: "2026-11-01",
      vendorRaw: "NAYAPAY RAW",
      vendorNormalized: "nayapay",
      category: "Uncategorized",
      source: "manual_missed",
      provenance: "{}",
      reviewStatus: "committed",
    });

    const rows = await db.select().from(transactions);
    expect(rows[0].amount).toBe(1250);
    expect(rows[0].userId).toBe(user.id);
    expect(Number.isInteger(rows[0].amount)).toBe(true);
  });

  test("amount column rejects a non-integer value", async () => {
    const db = drizzle(env.DB);
    const [user] = await db.insert(users).values({
      email: "amount@example.com",
      displayName: "Amount User",
      createdAt: "2026-11-01T00:00:00.000Z",
    }).returning();
    await expect(
      db.insert(transactions).values({
        userId: user.id,
        amount: 12.5 as unknown as number,
        date: "2026-11-01",
        vendorRaw: "x",
        vendorNormalized: "x",
        category: "Uncategorized",
        source: "manual_missed",
        provenance: "{}",
        reviewStatus: "committed",
      })
    ).rejects.toThrow();
  });

  test("inserting a transaction without userId rejects", async () => {
    const db = drizzle(env.DB);
    await expect(
      db.insert(transactions).values({
        amount: 1250,
        date: "2026-11-01",
        vendorRaw: "x",
        vendorNormalized: "x",
        source: "manual_missed",
        provenance: "{}",
        reviewStatus: "committed",
      } as typeof transactions.$inferInsert) // Deliberately omit the required owner.
    ).rejects.toThrow();
  });

  test("inserting a transaction with a valid userId round-trips correctly", async () => {
    const db = drizzle(env.DB);
    const [user] = await db.insert(users).values({
      email: "owner@example.com",
      displayName: "Owner",
      createdAt: "2026-11-01T00:00:00.000Z",
    }).returning();
    await db.insert(transactions).values({
      userId: user.id,
      amount: 2500,
      date: "2026-11-02",
      vendorRaw: "SHOP",
      vendorNormalized: "shop",
      source: "manual_missed",
      provenance: "{}",
      reviewStatus: "committed",
    });

    const rows = await db.select().from(transactions);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: user.id, amount: 2500, vendorNormalized: "shop" });
  });
});

describe("canonical D1 schema: authentication", () => {
  test("inserting a user and session round-trips correctly", async () => {
    const db = drizzle(env.DB);
    const [user] = await db.insert(users).values({
      email: "session@example.com",
      displayName: "Session User",
      avatarUrl: "https://example.com/avatar.png",
      createdAt: "2026-11-01T00:00:00.000Z",
    }).returning();
    await db.insert(sessions).values({
      id: "session-token",
      userId: user.id,
      expiresAt: "2026-12-01T00:00:00.000Z",
      createdAt: "2026-11-01T00:00:00.000Z",
      userAgent: "Schema test",
    });

    // Query by id rather than asserting on the whole table's contents --
    // migration 0004 seeds a sentinel "Unmigrated data" user (id 1) into
    // every fresh database so its existing NOT NULL userId backfill has a
    // row to point at, so this table is never actually empty before a
    // test's own insert.
    const userRows = await db.select().from(users).where(eq(users.id, user.id));
    expect(userRows).toEqual([{
      id: user.id,
      email: "session@example.com",
      displayName: "Session User",
      avatarUrl: "https://example.com/avatar.png",
      createdAt: "2026-11-01T00:00:00.000Z",
    }]);
    const sessionRows = await db.select().from(sessions);
    expect(sessionRows).toEqual([{
      id: "session-token",
      userId: user.id,
      expiresAt: "2026-12-01T00:00:00.000Z",
      createdAt: "2026-11-01T00:00:00.000Z",
      userAgent: "Schema test",
    }]);
  });

  test("inserting a Google auth identity round-trips correctly", async () => {
    const db = drizzle(env.DB);
    const [user] = await db.insert(users).values({
      email: "google@example.com",
      displayName: "Google User",
      createdAt: "2026-11-01T00:00:00.000Z",
    }).returning();
    await db.insert(authIdentities).values({
      userId: user.id,
      provider: "google",
      providerAccountId: "google-sub-123",
      createdAt: "2026-11-01T00:00:00.000Z",
    });

    const rows = await db.select().from(authIdentities);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: user.id,
      provider: "google",
      providerAccountId: "google-sub-123",
      passwordHash: null,
      createdAt: "2026-11-01T00:00:00.000Z",
    });
  });

  test("auth identities reject a duplicate provider and providerAccountId", async () => {
    const db = drizzle(env.DB);
    const [user] = await db.insert(users).values({
      email: "duplicate@example.com",
      displayName: "Duplicate User",
      createdAt: "2026-11-01T00:00:00.000Z",
    }).returning();
    await db.insert(authIdentities).values({
      userId: user.id,
      provider: "google",
      providerAccountId: "duplicate-sub",
      createdAt: "2026-11-01T00:00:00.000Z",
    });
    await expect(
      db.insert(authIdentities).values({
        userId: user.id,
        provider: "google",
        providerAccountId: "duplicate-sub",
        createdAt: "2026-11-01T00:00:00.000Z",
      })
    ).rejects.toThrow();
  });
});
