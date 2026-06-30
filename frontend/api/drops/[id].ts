import type { VercelRequest, VercelResponse } from "@vercel/node";
import { db, initDb, trackEvent } from "../_db.js";
import { buildMerkleTree, getMerkleProof } from "../_merkle.js";
import { evaluateRules } from "../_eligibility.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  await initDb();

  const { id } = req.query as { id: string };

  // GET /api/drops/:id
  if (req.method === "GET" && !req.url?.includes("/recipients") && !req.url?.includes("/eligibility") && !req.url?.includes("/claims")) {
    const dropRow = await db.execute({ sql: `SELECT * FROM drops WHERE id = ?`, args: [id] });
    if (dropRow.rows.length === 0) return res.status(404).json({ error: "Drop not found", code: "NOT_FOUND" });
    const drop = dropRow.rows[0];

    const statsRow = await db.execute({
      sql: `SELECT COUNT(*) as total, SUM(CASE WHEN claimed = 1 THEN 1 ELSE 0 END) as claimed FROM recipients WHERE drop_id = ?`,
      args: [id],
    });
    const stats = statsRow.rows[0];
    const total = Number(stats.total ?? 0);
    const claimed = Number(stats.claimed ?? 0);

    let ruleConfig = null;
    if (drop.rule_config) {
      try { ruleConfig = JSON.parse(drop.rule_config as string); } catch { /* ignore */ }
    }

    return res.json({
      ...Object.fromEntries(Object.entries(drop).map(([k, v]) => [k, v])),
      ruleConfig: ruleConfig?._layers ? null : ruleConfig,
      stats: { totalRecipients: total, claimedCount: claimed, claimRate: total ? claimed / total : 0 },
    });
  }

  return res.status(404).json({ error: "Not found" });
}
