/**
 * TrustDrop persistent database layer.
 *
 * Storage priority:
 * 1. Turso (libSQL over HTTPS) — set TURSO_DATABASE_URL + TURSO_AUTH_TOKEN
 * 2. GitHub repo file storage — set GITHUB_TOKEN + GITHUB_REPO (e.g. "user/repo")
 * 3. /tmp JSON files — ephemeral, resets on cold start (fallback only)
 */

import fs from "node:fs";

const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO; // e.g. "yogitabhambare3-a11y/Trust-drop"
const DIR = process.env.DB_DIR ?? "/tmp";

// ─── In-memory cache (survives within same warm instance) ─────────────────
const memCache: Record<string, unknown[]> = {};

// ─── GitHub file storage ──────────────────────────────────────────────────

async function githubRead(table: string): Promise<unknown[]> {
  if (!GITHUB_TOKEN || !GITHUB_REPO) return [];
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/data/td_${table}.json`,
      { headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json" } }
    );
    if (!res.ok) return [];
    const j = await res.json() as { content: string };
    return JSON.parse(Buffer.from(j.content, "base64").toString("utf8"));
  } catch { return []; }
}

async function githubWrite(table: string, data: unknown[]): Promise<void> {
  if (!GITHUB_TOKEN || !GITHUB_REPO) return;
  try {
    // Get current SHA
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/data/td_${table}.json`,
      { headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json" } }
    );
    const sha = res.ok ? (await res.json() as { sha: string }).sha : undefined;
    const content = Buffer.from(JSON.stringify(data)).toString("base64");
    await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/data/td_${table}.json`,
      {
        method: "PUT",
        headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message: `db: update ${table}`, content, ...(sha ? { sha } : {}) }),
      }
    );
  } catch { /* swallow */ }
}

// ─── Turso HTTP client ────────────────────────────────────────────────────

let _turso: import("@libsql/client").Client | null = null;

async function getTurso() {
  if (_turso) return _turso;
  const { createClient } = await import("@libsql/client/http" as string) as typeof import("@libsql/client");
  _turso = createClient({ url: TURSO_URL!, authToken: TURSO_TOKEN });
  await _turso.executeMultiple(`
    CREATE TABLE IF NOT EXISTS drops (id TEXT PRIMARY KEY, name TEXT NOT NULL, merkle_root TEXT NOT NULL, token TEXT NOT NULL, total_amount TEXT NOT NULL, claim_start INTEGER NOT NULL, claim_end INTEGER NOT NULL, admin_wallet TEXT NOT NULL, contract_drop_id INTEGER, contract_address TEXT, eligibility_mode TEXT NOT NULL DEFAULT 'csv', rule_config TEXT, created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')));
    CREATE TABLE IF NOT EXISTS recipients (id INTEGER PRIMARY KEY AUTOINCREMENT, drop_id TEXT NOT NULL, wallet TEXT NOT NULL, amount TEXT NOT NULL, claimed INTEGER NOT NULL DEFAULT 0, claim_tx_hash TEXT, claimed_at INTEGER, UNIQUE(drop_id, wallet));
    CREATE TABLE IF NOT EXISTS feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, drop_id TEXT NOT NULL, wallet TEXT NOT NULL, rating INTEGER NOT NULL, comment TEXT, created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')));
    CREATE TABLE IF NOT EXISTS analytics_events (id INTEGER PRIMARY KEY AUTOINCREMENT, drop_id TEXT, event_type TEXT NOT NULL, wallet TEXT, metadata TEXT, created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')));
  `);
  return _turso;
}

// ─── Generic read/write ───────────────────────────────────────────────────

async function readTable<T>(name: string): Promise<T[]> {
  if (memCache[name]) return memCache[name] as T[];
  if (GITHUB_TOKEN && GITHUB_REPO) {
    const data = await githubRead(name) as T[];
    memCache[name] = data;
    return data;
  }
  try { return JSON.parse(fs.readFileSync(`${DIR}/td_${name}.json`, "utf8")) as T[]; }
  catch { return []; }
}

async function writeTable<T>(name: string, data: T[]): Promise<void> {
  memCache[name] = data;
  if (GITHUB_TOKEN && GITHUB_REPO) {
    await githubWrite(name, data);
    return;
  }
  try { fs.writeFileSync(`${DIR}/td_${name}.json`, JSON.stringify(data)); } catch { /* swallow */ }
}

function nextId<T extends { id: number }>(rows: T[]): number {
  return rows.length > 0 ? Math.max(...rows.map(r => r.id)) + 1 : 1;
}

// ─── Types ────────────────────────────────────────────────────────────────

interface Drop { id: string; name: string; merkle_root: string; token: string; total_amount: string; claim_start: number; claim_end: number; admin_wallet: string; contract_drop_id: number | null; contract_address: string | null; eligibility_mode: string; rule_config: string | null; created_at: number; }
interface Recipient { id: number; drop_id: string; wallet: string; amount: string; claimed: number; claim_tx_hash: string | null; claimed_at: number | null; }
interface Feedback { id: number; drop_id: string; wallet: string; rating: number; comment: string | null; created_at: number; }
interface AnalyticsEvent { id: number; drop_id: string | null; event_type: string; wallet: string | null; metadata: string | null; created_at: number; }

// ─── Public API ───────────────────────────────────────────────────────────

export async function insertDrop(d: Omit<Drop, "created_at">): Promise<void> {
  if (TURSO_URL) {
    const db = await getTurso();
    await db.execute({ sql: `INSERT INTO drops (id,name,merkle_root,token,total_amount,claim_start,claim_end,admin_wallet,contract_drop_id,contract_address,eligibility_mode,rule_config) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, args: [d.id,d.name,d.merkle_root,d.token,d.total_amount,d.claim_start,d.claim_end,d.admin_wallet,d.contract_drop_id,d.contract_address,d.eligibility_mode,d.rule_config] });
    return;
  }
  const rows = await readTable<Drop>("drops");
  rows.push({ ...d, created_at: Math.floor(Date.now() / 1000) });
  await writeTable("drops", rows);
}

export async function getDropById(id: string): Promise<Drop | undefined> {
  if (TURSO_URL) {
    const db = await getTurso();
    const r = await db.execute({ sql: `SELECT * FROM drops WHERE id = ?`, args: [id] });
    return r.rows[0] as unknown as Drop | undefined;
  }
  return (await readTable<Drop>("drops")).find(d => d.id === id);
}

export async function insertRecipient(drop_id: string, wallet: string, amount: string): Promise<void> {
  if (TURSO_URL) {
    const db = await getTurso();
    await db.execute({ sql: `INSERT OR IGNORE INTO recipients (drop_id,wallet,amount) VALUES (?,?,?)`, args: [drop_id, wallet, amount] });
    return;
  }
  const rows = await readTable<Recipient>("recipients");
  if (rows.find(r => r.drop_id === drop_id && r.wallet === wallet)) return;
  rows.push({ id: nextId(rows), drop_id, wallet, amount, claimed: 0, claim_tx_hash: null, claimed_at: null });
  await writeTable("recipients", rows);
}

export async function getRecipient(drop_id: string, wallet: string): Promise<Recipient | undefined> {
  if (TURSO_URL) {
    const db = await getTurso();
    const r = await db.execute({ sql: `SELECT * FROM recipients WHERE drop_id=? AND wallet=?`, args: [drop_id, wallet] });
    return r.rows[0] as unknown as Recipient | undefined;
  }
  return (await readTable<Recipient>("recipients")).find(r => r.drop_id === drop_id && r.wallet === wallet);
}

export async function getRecipients(drop_id: string): Promise<Recipient[]> {
  if (TURSO_URL) {
    const db = await getTurso();
    const r = await db.execute({ sql: `SELECT * FROM recipients WHERE drop_id=?`, args: [drop_id] });
    return r.rows as unknown as Recipient[];
  }
  return (await readTable<Recipient>("recipients")).filter(r => r.drop_id === drop_id);
}

export async function markClaimed(drop_id: string, wallet: string, txHash: string): Promise<void> {
  if (TURSO_URL) {
    const db = await getTurso();
    await db.execute({ sql: `UPDATE recipients SET claimed=1, claim_tx_hash=?, claimed_at=strftime('%s','now') WHERE drop_id=? AND wallet=?`, args: [txHash, drop_id, wallet] });
    return;
  }
  const rows = await readTable<Recipient>("recipients");
  const row = rows.find(r => r.drop_id === drop_id && r.wallet === wallet);
  if (row) { row.claimed = 1; row.claim_tx_hash = txHash; row.claimed_at = Math.floor(Date.now() / 1000); await writeTable("recipients", rows); }
}

export async function getDropStats(drop_id: string): Promise<{ total: number; claimed: number }> {
  const rows = await getRecipients(drop_id);
  return { total: rows.length, claimed: rows.filter(r => r.claimed === 1).length };
}

export async function insertFeedback(drop_id: string, wallet: string, rating: number, comment: string | null): Promise<void> {
  if (TURSO_URL) {
    const db = await getTurso();
    await db.execute({ sql: `INSERT INTO feedback (drop_id,wallet,rating,comment) VALUES (?,?,?,?)`, args: [drop_id, wallet, rating, comment] });
    return;
  }
  const rows = await readTable<Feedback>("feedback");
  rows.push({ id: nextId(rows), drop_id, wallet, rating, comment, created_at: Math.floor(Date.now() / 1000) });
  await writeTable("feedback", rows);
}

export async function getFeedbackStats(drop_id: string): Promise<{ averageRating: number; count: number }> {
  if (TURSO_URL) {
    const db = await getTurso();
    const r = await db.execute({ sql: `SELECT AVG(rating) as avg, COUNT(*) as cnt FROM feedback WHERE drop_id=?`, args: [drop_id] });
    const row = r.rows[0] as unknown as { avg: number | null; cnt: number };
    return { averageRating: row?.avg ?? 0, count: row?.cnt ?? 0 };
  }
  const rows = (await readTable<Feedback>("feedback")).filter(r => r.drop_id === drop_id);
  return { averageRating: rows.length ? rows.reduce((s, r) => s + r.rating, 0) / rows.length : 0, count: rows.length };
}

export async function trackEvent(event_type: string, drop_id?: string, wallet?: string, metadata?: Record<string, unknown>): Promise<void> {
  if (TURSO_URL) {
    const db = await getTurso();
    await db.execute({ sql: `INSERT INTO analytics_events (drop_id,event_type,wallet,metadata) VALUES (?,?,?,?)`, args: [drop_id ?? null, event_type, wallet ?? null, metadata ? JSON.stringify(metadata) : null] });
    return;
  }
  const rows = await readTable<AnalyticsEvent>("events");
  rows.push({ id: nextId(rows), drop_id: drop_id ?? null, event_type, wallet: wallet ?? null, metadata: metadata ? JSON.stringify(metadata) : null, created_at: Math.floor(Date.now() / 1000) });
  await writeTable("events", rows);
}

export async function getEventCounts(drop_id: string): Promise<Record<string, number>> {
  if (TURSO_URL) {
    const db = await getTurso();
    const r = await db.execute({ sql: `SELECT event_type, COUNT(*) as count FROM analytics_events WHERE drop_id=? GROUP BY event_type`, args: [drop_id] });
    const counts: Record<string, number> = {};
    for (const row of r.rows) counts[row.event_type as string] = Number(row.count);
    return counts;
  }
  const rows = (await readTable<AnalyticsEvent>("events")).filter(r => r.drop_id === drop_id);
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.event_type] = (counts[r.event_type] ?? 0) + 1;
  return counts;
}

export async function getClaimEvents(drop_id: string) {
  const rows = await getRecipients(drop_id);
  return rows.filter(r => r.claimed === 1).map(r => ({ wallet: r.wallet, claim_tx_hash: r.claim_tx_hash, claimed_at: r.claimed_at }));
}
