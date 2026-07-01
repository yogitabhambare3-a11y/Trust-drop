import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb, dbGet, dbAll } from "../_db.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).end();

  const { dropId } = req.query as { dropId: string };
  const db = await getDb();

  const drop = dbGet(db, `SELECT id FROM drops WHERE id = ?`, [dropId]);
  if (!drop) return res.status(404).json({ error: "Drop not found" });

  const claims = dbAll(db, `SELECT wallet, claim_tx_hash, claimed_at FROM recipients WHERE drop_id = ? AND claimed = 1 ORDER BY claimed_at ASC`, [dropId]);
  const events = dbAll(db, `SELECT event_type, COUNT(*) as count FROM analytics_events WHERE drop_id = ? GROUP BY event_type`, [dropId]);
  const feedbackRow = dbGet(db, `SELECT AVG(rating) as avgRating, COUNT(*) as count FROM feedback WHERE drop_id = ?`, [dropId]);

  return res.json({
    dropId,
    claims,
    events,
    feedback: { averageRating: feedbackRow?.avgRating ?? 0, count: feedbackRow?.count ?? 0 },
  });
}
