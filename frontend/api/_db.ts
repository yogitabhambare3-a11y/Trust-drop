import fs from "node:fs";
import path from "node:path";
import initSqlJs, { type Database } from "sql.js";

// /tmp is the only writable path in Vercel serverless.
// The DB is ephemeral per cold-start – fine for a demo/testnet deployment.
// For persistence, mount a Vercel Postgres or Turso DB and set TURSO_DATABASE_URL.
const DB_PATH = process.env.DB_PATH ?? "/tmp/trustdrop.db";

let _db: Database | null = null;

export async function getDb(): Promise<Database> {
  if (_db) return _db;

  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    _db = new SQL.Database(buf);
  } else {
    _db = new SQL.Database();
  }

  _db.run(`
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

  persist(_db);
  return _db;
}

function persist(db: Database) {
  try {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  } catch {
    // /tmp may not exist in some environments – swallow
  }
}

// Typed query helpers that mirror the better-sqlite3 API surface used by routes.
export function dbRun(db: Database, sql: string, params: unknown[] = []) {
  db.run(sql, params);
  persist(db);
}

export function dbGet(db: Database, sql: string, params: unknown[] = []): Record<string, unknown> | undefined {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row as Record<string, unknown>;
  }
  stmt.free();
  return undefined;
}

export function dbAll(db: Database, sql: string, params: unknown[] = []): Record<string, unknown>[] {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows: Record<string, unknown>[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as Record<string, unknown>);
  }
  stmt.free();
  return rows;
}

export async function trackEvent(
  eventType: string,
  dropId?: string,
  wallet?: string,
  metadata?: Record<string, unknown>
) {
  const db = await getDb();
  dbRun(db,
    `INSERT INTO analytics_events (drop_id, event_type, wallet, metadata) VALUES (?, ?, ?, ?)`,
    [dropId ?? null, eventType, wallet ?? null, metadata ? JSON.stringify(metadata) : null]
  );
}
