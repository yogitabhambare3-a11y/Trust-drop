import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb, dbRun, trackEvent } from "../../_db.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  const { id } = req.query as { id: string };
  const { wallet, txHash } = req.body as { wallet?: string; txHash?: string };
  if (!wallet || !txHash) return res.status(400).json({ error: "wallet and txHash required" });

  const db = await getDb();
  dbRun(db,
    `UPDATE recipients SET claimed = 1, claim_tx_hash = ?, claimed_at = strftime('%s','now') WHERE drop_id = ? AND wallet = ?`,
    [txHash, id, wallet]
  );
  await trackEvent("claim_success", id, wallet, { txHash });
  return res.json({ ok: true });
}
