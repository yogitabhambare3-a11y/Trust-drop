import { createClient } from "@libsql/client";
import path from "node:path";

// In Vercel serverless /tmp is the only writable path.
// For a persistent DB, set TURSO_DATABASE_URL + TURSO_AUTH_TOKEN env vars
// to point at a free Turso cloud database. Falls back to local /tmp for dev.
const dbUrl = process.env.TURSO_DATABASE_URL ?? `file:${path.join("/tmp", "trustdrop.db")}`;
const authToken = process.env.TURSO_AUTH_TOKEN;

export const db = createClient({
  url: dbUrl,
  ...(authToken ? { authToken } : {}),
});

export async function initDb() {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS drops (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      merkle_root TEXT NOT NULL,
      token TEXT NOT NULL,
      total_amount TEXT NOT NULL,
      claim_start INTEGER NOT NULL,
      claim_end INTEGER NOT NULL,
      admin_wallet TEXT NOT NULL,
      contract_drop_id INTEGER,
      contract_address TEXT,
      eligibility_mode TEXT NOT NULL DEFAULT 'csv',
      rule_config TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS recipients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drop_id TEXT NOT NULL,
      wallet TEXT NOT NULL,
      amount TEXT NOT NULL,
      claimed INTEGER NOT NULL DEFAULT 0,
      claim_tx_hash TEXT,
      claimed_at INTEGER,
      UNIQUE(drop_id, wallet)
    );

    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drop_id TEXT NOT NULL,
      wallet TEXT NOT NULL,
      rating INTEGER NOT NULL,
      comment TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS analytics_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drop_id TEXT,
      event_type TEXT NOT NULL,
      wallet TEXT,
      metadata TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
  `);
}

export async function trackEvent(
  eventType: string,
  dropId?: string,
  wallet?: string,
  metadata?: Record<string, unknown>
) {
  await db.execute({
    sql: `INSERT INTO analytics_events (drop_id, event_type, wallet, metadata) VALUES (?, ?, ?, ?)`,
    args: [dropId ?? null, eventType, wallet ?? null, metadata ? JSON.stringify(metadata) : null],
  });
}
