import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb, dbRun, trackEvent } from "./_db.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  const { dropId, wallet, rating, comment } = req.body as {
    dropId?: string; wallet?: string; rating?: number; comment?: string;
  };
  if (!dropId || !wallet || !rating) return res.status(400).json({ error: "dropId, wallet, rating required" });
  if (rating < 1 || rating > 5) return res.status(400).json({ error: "rating must be 1-5" });

  const db = await getDb();
  dbRun(db, `INSERT INTO feedback (drop_id, wallet, rating, comment) VALUES (?,?,?,?)`, [dropId, wallet, rating, comment ?? null]);
  await trackEvent("feedback_submitted", dropId, wallet, { rating });
  return res.status(201).json({ ok: true });
}
