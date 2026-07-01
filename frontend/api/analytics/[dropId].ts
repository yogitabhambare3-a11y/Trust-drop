import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDropById, getClaimEvents, getEventCounts, getFeedbackStats } from "../_db.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).end();

  const { dropId } = req.query as { dropId: string };
  if (!getDropById(dropId)) return res.status(404).json({ error: "Drop not found" });

  return res.json({
    dropId,
    claims: getClaimEvents(dropId),
    events: Object.entries(getEventCounts(dropId)).map(([event_type, count]) => ({ event_type, count })),
    feedback: getFeedbackStats(dropId),
  });
}
