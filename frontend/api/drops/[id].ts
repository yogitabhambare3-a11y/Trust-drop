import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb, dbGet, dbAll } from "../_db.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).end();

  const { id } = req.query as { id: string };
  const db = await getDb();

  const drop = dbGet(db, `SELECT * FROM drops WHERE id = ?`, [id]);
  if (!drop) return res.status(404).json({ error: "Drop not found", code: "NOT_FOUND" });

  const statsRows = dbAll(db,
    `SELECT COUNT(*) as total, SUM(CASE WHEN claimed = 1 THEN 1 ELSE 0 END) as claimed FROM recipients WHERE drop_id = ?`,
    [id]
  );
  const stats = statsRows[0] ?? { total: 0, claimed: 0 };
  const total = Number(stats.total ?? 0);
  const claimed = Number(stats.claimed ?? 0);

  let ruleConfig = null;
  if (drop.rule_config) {
    try { ruleConfig = JSON.parse(drop.rule_config as string); } catch { /* ignore */ }
  }

  return res.json({
    ...drop,
    ruleConfig,
    stats: { totalRecipients: total, claimedCount: claimed, claimRate: total ? claimed / total : 0 },
  });
}
