/**
 * TrustDrop persistent database layer.
 *
 * Uses Turso (libSQL over HTTPS) when TURSO_DATABASE_URL + TURSO_AUTH_TOKEN are set.
 * Falls back to /tmp JSON files (ephemeral, resets on cold start) otherwise.
 *
 * Setup Turso free DB in 2 minutes:
 *   1. Go to https://turso.tech → Sign up free
 *   2. Create a database named "trustdrop"
 *   3. Copy the database URL (libsql://trustdrop-xxx.turso.io)
 *   4. Create an auth token
 *   5. Add to Vercel env vars:
 *      TURSO_DATABASE_URL = libsql://trustdrop-xxx.turso.io
 *      TURSO_AUTH_TOKEN   = your-auth-token
 */

import fs from "node:fs";

// ─── Turso HTTP client (no native bindings) ───────────────────────────────

const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;

let _turso: import("@libsql/client").Client | null = null;

async function getTurso() {
  if (_turso) return _turso;
  const { createClient } = await import("@libsql/client/http" as string) as typeof import("@libsql/client");
  _turso = createClient({ url: TURSO_URL!, authToken: TURSO_TOKEN });
  await _turso.executeMultiple(`
    CREATE TABLE IF NOT EXISTS drops (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, merkle_root TEXT NOT NULL,
      token TEXT NOT NULL, total_amount TEXT NOT NULL,
      claim_start INTEGER NOT NULL, claim_end INTEGER NOT NULL,
      admin_wallet TEXT NOT NULL, contract_drop_id INTEGER,
      contract_address TEXT, eligibility_mode TEXT NOT NULL DEFAULT 'csv',
      rule_config TEXT, created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE TABLE IF NOT EXISTS recipients (
      id INTEGER PRIMARY KEY AUTOINCREMENT, drop_id TEXT NOT NULL,
      wallet TEXT NOT NULL, amount TEXT NOT NULL,
      claimed INTEGER NOT NULL DEFAULT 0, claim_tx_hash TEXT, claimed_at INTEGER,
      UNIQUE(drop_id, wallet)
    );
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT, drop_id TEXT NOT NULL,
      wallet TEXT NOT NULL, rating INTEGER NOT NULL,
      comment TEXT, created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE TABLE IF NOT EXISTS analytics_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, drop_id TEXT,
      event_type TEXT NOT NULL, wallet TEXT, metadata TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
  `);
  return _turso;
}

// ─── JSON /tmp fallback ───────────────────────────────────────────────────

const DIR = process.env.DB_DIR ?? "/tmp";

interface Drop {
  id: string; name: string; merkle_root: string; token: string;
  total_amount: string; claim_start: number; claim_end: number;
  admin_wallet: string; contract_drop_id: number | null;
  contract_address: string | null; eligibility_mode: string;
  rule_config: string | null; created_at: number;
}
interface Recipient {
  id: number; drop_id: string; wallet: string; amount: string;
  claimed: number; claim_tx_hash: string | null; claimed_at: number | null;
}
interface Feedback {
  id: number; drop_id: string; wallet: string; rating: number;
  comment: string | null; created_at: number;
}
interface AnalyticsEvent {
  id: number; drop_id: string | null; event_type: string;
  wallet: string | null; metadata: string | null; created_at: number;
}

function readTable<T>(name: string): T[] {
  try { return JSON.parse(fs.readFileSync(`${DIR}/td_${name}.json`, "utf8")) as T[]; }
  catch { return []; }
}
function writeTable<T>(name: string, data: T[]) {
  try { fs.writeFileSync(`${DIR}/td_${name}.json`, JSON.stringify(data)); } catch { /* swallow */ }
}
function nextId(table: string): number {
  const rows = readTable<{ id: number }>(table);
  return rows.length > 0 ? Math.max(...rows.map(r => r.id)) + 1 : 1;
}

// ─── Public API ───────────────────────────────────────────────────────────

export async function insertDrop(d: Omit<Drop, "created_at">): Promise<void> {
  if (TURSO_URL) {
    const db = await getTurso();
    await db.execute({
      sql: `INSERT INTO drops (id,name,merkle_root,token,total_amount,claim_start,claim_end,admin_wallet,contract_drop_id,contract_address,eligibility_mode,rule_config) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [d.id, d.name, d.merkle_root, d.token, d.total_amount, d.claim_start, d.claim_end, d.admin_wallet, d.contract_drop_id, d.contract_address, d.eligibility_mode, d.rule_config],
    });
  } else {
    const drops = readTable<Drop>("drops");
    drops.push({ ...d, created_at: Math.floor(Date.now() / 1000) });
    writeTable("drops", drops);
  }
}

export async function getDropById(id: string): Promise<Drop | undefined> {
  if (TURSO_URL) {
    const db = await getTurso();
    const r = await db.execute({ sql: `SELECT * FROM drops WHERE id = ?`, args: [id] });
    return r.rows[0] as unknown as Drop | undefined;
  }
  return readTable<Drop>("drops").find(d => d.id === id);
}

export async function insertRecipient(drop_id: string, wallet: string, amount: string): Promise<void> {
  if (TURSO_URL) {
    const db = await getTurso();
    await db.execute({ sql: `INSERT OR IGNORE INTO recipients (drop_id,wallet,amount) VALUES (?,?,?)`, args: [drop_id, wallet, amount] });
  } else {
    const rows = readTable<Recipient>("recipients");
    if (rows.find(r => r.drop_id === drop_id && r.wallet === wallet)) return;
    rows.push({ id: nextId("recipients"), drop_id, wallet, amount, claimed: 0, claim_tx_hash: null, claimed_at: null });
    writeTable("recipients", rows);
  }
}

export async function getRecipient(drop_id: string, wallet: string): Promise<Recipient | undefined> {
  if (TURSO_URL) {
    const db = await getTurso();
    const r = await db.execute({ sql: `SELECT * FROM recipients WHERE drop_id=? AND wallet=?`, args: [drop_id, wallet] });
    return r.rows[0] as unknown as Recipient | undefined;
  }
  return readTable<Recipient>("recipients").find(r => r.drop_id === drop_id && r.wallet === wallet);
}

export async function getRecipients(drop_id: string): Promise<Recipient[]> {
  if (TURSO_URL) {
    const db = await getTurso();
    const r = await db.execute({ sql: `SELECT * FROM recipients WHERE drop_id=?`, args: [drop_id] });
    return r.rows as unknown as Recipient[];
  }
  return readTable<Recipient>("recipients").filter(r => r.drop_id === drop_id);
}

export async function markClaimed(drop_id: string, wallet: string, txHash: string): Promise<void> {
  if (TURSO_URL) {
    const db = await getTurso();
    await db.execute({ sql: `UPDATE recipients SET claimed=1, claim_tx_hash=?, claimed_at=strftime('%s','now') WHERE drop_id=? AND wallet=?`, args: [txHash, drop_id, wallet] });
  } else {
    const rows = readTable<Recipient>("recipients");
    const row = rows.find(r => r.drop_id === drop_id && r.wallet === wallet);
    if (row) { row.claimed = 1; row.claim_tx_hash = txHash; row.claimed_at = Math.floor(Date.now() / 1000); writeTable("recipients", rows); }
  }
}

export async function getDropStats(drop_id: string): Promise<{ total: number; claimed: number }> {
  const rows = await getRecipients(drop_id);
  return { total: rows.length, claimed: rows.filter(r => r.claimed === 1).length };
}

export async function insertFeedback(drop_id: string, wallet: string, rating: number, comment: string | null): Promise<void> {
  if (TURSO_URL) {
    const db = await getTurso();
    await db.execute({ sql: `INSERT INTO feedback (drop_id,wallet,rating,comment) VALUES (?,?,?,?)`, args: [drop_id, wallet, rating, comment] });
  } else {
    const rows = readTable<Feedback>("feedback");
    rows.push({ id: nextId("feedback"), drop_id, wallet, rating, comment, created_at: Math.floor(Date.now() / 1000) });
    writeTable("feedback", rows);
  }
}

export async function getFeedbackStats(drop_id: string): Promise<{ averageRating: number; count: number }> {
  if (TURSO_URL) {
    const db = await getTurso();
    const r = await db.execute({ sql: `SELECT AVG(rating) as avg, COUNT(*) as cnt FROM feedback WHERE drop_id=?`, args: [drop_id] });
    const row = r.rows[0] as unknown as { avg: number | null; cnt: number };
    return { averageRating: row?.avg ?? 0, count: row?.cnt ?? 0 };
  }
  const rows = readTable<Feedback>("feedback").filter(r => r.drop_id === drop_id);
  return { averageRating: rows.length ? rows.reduce((s, r) => s + r.rating, 0) / rows.length : 0, count: rows.length };
}

export async function trackEvent(event_type: string, drop_id?: string, wallet?: string, metadata?: Record<string, unknown>): Promise<void> {
  if (TURSO_URL) {
    const db = await getTurso();
    await db.execute({ sql: `INSERT INTO analytics_events (drop_id,event_type,wallet,metadata) VALUES (?,?,?,?)`, args: [drop_id ?? null, event_type, wallet ?? null, metadata ? JSON.stringify(metadata) : null] });
  } else {
    const rows = readTable<AnalyticsEvent>("events");
    rows.push({ id: nextId("events"), drop_id: drop_id ?? null, event_type, wallet: wallet ?? null, metadata: metadata ? JSON.stringify(metadata) : null, created_at: Math.floor(Date.now() / 1000) });
    writeTable("events", rows);
  }
}

export async function getEventCounts(drop_id: string): Promise<Record<string, number>> {
  if (TURSO_URL) {
    const db = await getTurso();
    const r = await db.execute({ sql: `SELECT event_type, COUNT(*) as count FROM analytics_events WHERE drop_id=? GROUP BY event_type`, args: [drop_id] });
    const counts: Record<string, number> = {};
    for (const row of r.rows) counts[row.event_type as string] = Number(row.count);
    return counts;
  }
  const rows = readTable<AnalyticsEvent>("events").filter(r => r.drop_id === drop_id);
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.event_type] = (counts[r.event_type] ?? 0) + 1;
  return counts;
}

export async function getClaimEvents(drop_id: string) {
  const rows = await getRecipients(drop_id);
  return rows.filter(r => r.claimed === 1).map(r => ({ wallet: r.wallet, claim_tx_hash: r.claim_tx_hash, claimed_at: r.claimed_at }));
}
