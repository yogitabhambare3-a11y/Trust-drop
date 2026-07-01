/**
 * Lightweight JSON-file database for Vercel serverless.
 * /tmp is writable and persists within a warm lambda instance.
 * Each table is a JSON array stored in /tmp/trustdrop-<table>.json
 *
 * For a production persistent store, set TURSO_DATABASE_URL + TURSO_AUTH_TOKEN
 * to point at a free Turso (libSQL over HTTPS) database — no native binaries needed.
 */

import fs from "node:fs";

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
  const p = `${DIR}/td_${name}.json`;
  try { return JSON.parse(fs.readFileSync(p, "utf8")) as T[]; } catch { return []; }
}

function writeTable<T>(name: string, data: T[]) {
  try { fs.writeFileSync(`${DIR}/td_${name}.json`, JSON.stringify(data)); } catch { /* swallow */ }
}

let _recipientSeq = -1;
let _feedbackSeq = -1;
let _eventSeq = -1;

function nextId(table: string): number {
  const rows = readTable<{ id: number }>(table);
  return rows.length > 0 ? Math.max(...rows.map(r => r.id)) + 1 : 1;
}

// ─── Drops ─────────────────────────────────────────────────────────────────

export function insertDrop(d: Omit<Drop, "created_at">): void {
  const drops = readTable<Drop>("drops");
  drops.push({ ...d, created_at: Math.floor(Date.now() / 1000) });
  writeTable("drops", drops);
}

export function getDropById(id: string): Drop | undefined {
  return readTable<Drop>("drops").find(d => d.id === id);
}

// ─── Recipients ─────────────────────────────────────────────────────────────

export function insertRecipient(drop_id: string, wallet: string, amount: string): void {
  const rows = readTable<Recipient>("recipients");
  if (rows.find(r => r.drop_id === drop_id && r.wallet === wallet)) return;
  rows.push({ id: nextId("recipients"), drop_id, wallet, amount, claimed: 0, claim_tx_hash: null, claimed_at: null });
  writeTable("recipients", rows);
}

export function getRecipient(drop_id: string, wallet: string): Recipient | undefined {
  return readTable<Recipient>("recipients").find(r => r.drop_id === drop_id && r.wallet === wallet);
}

export function getRecipients(drop_id: string): Recipient[] {
  return readTable<Recipient>("recipients").filter(r => r.drop_id === drop_id);
}

export function markClaimed(drop_id: string, wallet: string, txHash: string): void {
  const rows = readTable<Recipient>("recipients");
  const row = rows.find(r => r.drop_id === drop_id && r.wallet === wallet);
  if (row) {
    row.claimed = 1;
    row.claim_tx_hash = txHash;
    row.claimed_at = Math.floor(Date.now() / 1000);
    writeTable("recipients", rows);
  }
}

export function getDropStats(drop_id: string) {
  const rows = getRecipients(drop_id);
  return { total: rows.length, claimed: rows.filter(r => r.claimed === 1).length };
}

// ─── Feedback ────────────────────────────────────────────────────────────────

export function insertFeedback(drop_id: string, wallet: string, rating: number, comment: string | null): void {
  const rows = readTable<Feedback>("feedback");
  rows.push({ id: nextId("feedback"), drop_id, wallet, rating, comment, created_at: Math.floor(Date.now() / 1000) });
  writeTable("feedback", rows);
}

export function getFeedbackStats(drop_id: string) {
  const rows = readTable<Feedback>("feedback").filter(r => r.drop_id === drop_id);
  const avg = rows.length ? rows.reduce((s, r) => s + r.rating, 0) / rows.length : 0;
  return { averageRating: avg, count: rows.length };
}

// ─── Analytics ───────────────────────────────────────────────────────────────

export function trackEvent(event_type: string, drop_id?: string, wallet?: string, metadata?: Record<string, unknown>): void {
  const rows = readTable<AnalyticsEvent>("events");
  rows.push({
    id: nextId("events"),
    drop_id: drop_id ?? null,
    event_type,
    wallet: wallet ?? null,
    metadata: metadata ? JSON.stringify(metadata) : null,
    created_at: Math.floor(Date.now() / 1000),
  });
  writeTable("events", rows);
}

export function getEventCounts(drop_id: string): Record<string, number> {
  const rows = readTable<AnalyticsEvent>("events").filter(r => r.drop_id === drop_id);
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.event_type] = (counts[r.event_type] ?? 0) + 1;
  return counts;
}

export function getClaimEvents(drop_id: string) {
  return readTable<Recipient>("recipients")
    .filter(r => r.drop_id === drop_id && r.claimed === 1)
    .map(r => ({ wallet: r.wallet, claim_tx_hash: r.claim_tx_hash, claimed_at: r.claimed_at }));
}
