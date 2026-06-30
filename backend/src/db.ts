import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DATABASE_PATH ?? path.join(__dirname, "../../data/trustdrop.db");

export const db = new Database(dbPath);

db.exec(`
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
    UNIQUE(drop_id, wallet),
    FOREIGN KEY (drop_id) REFERENCES drops(id)
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

export function trackEvent(
  eventType: string,
  dropId?: string,
  wallet?: string,
  metadata?: Record<string, unknown>
) {
  db.prepare(
    `INSERT INTO analytics_events (drop_id, event_type, wallet, metadata) VALUES (?, ?, ?, ?)`
  ).run(dropId ?? null, eventType, wallet ?? null, metadata ? JSON.stringify(metadata) : null);
}
