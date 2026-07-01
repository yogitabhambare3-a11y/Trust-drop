import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb, dbAll } from "../../_db.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).end();

  const { id } = req.query as { id: string };
  const db = await getDb();
  const rows = dbAll(db, `SELECT wallet, amount, claimed, claim_tx_hash, claimed_at FROM recipients WHERE drop_id = ?`, [id]);
  return res.json({ recipients: rows });
}
