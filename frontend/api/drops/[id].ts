import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDropById, getDropStats } from "../_db.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).end();

  const { id } = req.query as { id: string };
  const drop = getDropById(id);
  if (!drop) return res.status(404).json({ error: "Drop not found", code: "NOT_FOUND" });

  const { total, claimed } = getDropStats(id);
  let ruleConfig = null;
  if (drop.rule_config) { try { ruleConfig = JSON.parse(drop.rule_config); } catch { /* ignore */ } }

  return res.json({
    ...drop,
    ruleConfig,
    stats: { totalRecipients: total, claimedCount: claimed, claimRate: total ? claimed / total : 0 },
  });
}
