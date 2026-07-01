/**
 * TrustDrop unified API handler.
 * All routes go through this single function so /tmp is shared within the same
 * warm lambda instance (solves cross-function /tmp isolation issue).
 *
 * Routes:
 *   GET  /api/health
 *   POST /api/drops
 *   GET  /api/drops/:id
 *   GET  /api/drops/:id/recipients
 *   GET  /api/drops/:id/eligibility/:wallet
 *   POST /api/drops/:id/claims
 *   POST /api/feedback
 *   GET  /api/analytics/:dropId
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomUUID } from "node:crypto";
import {
  insertDrop, getDropById, getDropStats,
  insertRecipient, getRecipients, getRecipient, markClaimed,
  insertFeedback, getFeedbackStats,
  trackEvent, getClaimEvents, getEventCounts,
} from "./_db.js";
import { buildMerkleTree, parseCsvRecipients, getMerkleProof } from "./_merkle.js";
import { evaluateRules } from "./_eligibility.js";

// ─── Multipart parser ──────────────────────────────────────────────────────

async function parseMultipart(req: VercelRequest): Promise<{ fields: Record<string, string>; csv?: string }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks);
      const ct = req.headers["content-type"] ?? "";
      const boundary = ct.split("boundary=")[1];
      if (!boundary) { reject(new Error("No boundary")); return; }
      const fields: Record<string, string> = {};
      let csv: string | undefined;
      const boundaryBuf = Buffer.from(`--${boundary}`);
      const parts: Buffer[] = [];
      let start = 0;
      for (let i = 0; i <= raw.length - boundaryBuf.length; i++) {
        if (raw.slice(i, i + boundaryBuf.length).equals(boundaryBuf)) {
          if (start > 0) parts.push(raw.slice(start, i - 2));
          start = i + boundaryBuf.length + 2;
        }
      }
      for (const part of parts) {
        const he = part.indexOf("\r\n\r\n");
        if (he === -1) continue;
        const h = part.slice(0, he).toString();
        const c = part.slice(he + 4);
        const nm = h.match(/name="([^"]+)"/);
        const fm = h.match(/filename="([^"]+)"/);
        if (!nm) continue;
        if (fm) csv = c.toString("utf8");
        else fields[nm[1]] = c.toString("utf8").replace(/\r\n$/, "");
      }
      resolve({ fields, csv });
    });
    req.on("error", reject);
  });
}

// ─── Route handlers ────────────────────────────────────────────────────────

function health(_req: VercelRequest, res: VercelResponse) {
  return res.json({ status: "ok", service: "trustdrop-api" });
}

async function createDrop(req: VercelRequest, res: VercelResponse) {
  const ct = req.headers["content-type"] ?? "";
  let name: string, token: string, adminWallet: string;
  let claimStart: number, claimEnd: number;
  let eligibilityMode: "csv" | "rules";
  let contractDropId: number | null = null;
  let contractAddress: string | null = null;
  let ruleConfig: Record<string, unknown> | null = null;
  let recipients: { wallet: string; amount: bigint }[] = [];
  let csv: string | undefined;

  if (ct.includes("multipart/form-data")) {
    const { fields, csv: c } = await parseMultipart(req);
    csv = c;
    name = fields.name; token = fields.token ?? "native";
    claimStart = Number(fields.claimStart); claimEnd = Number(fields.claimEnd);
    adminWallet = fields.adminWallet;
    eligibilityMode = (fields.eligibilityMode ?? "csv") as "csv" | "rules";
    contractDropId = fields.contractDropId ? Number(fields.contractDropId) : null;
    contractAddress = fields.contractAddress ?? null;
    ruleConfig = fields.ruleConfig ? JSON.parse(fields.ruleConfig) : null;
    if (fields.recipients) {
      recipients = (JSON.parse(fields.recipients) as Array<{ wallet: string; amount: string }>)
        .map(r => ({ wallet: r.wallet, amount: BigInt(r.amount) }));
    }
  } else {
    const b = req.body as Record<string, unknown>;
    name = b.name as string; token = (b.token as string) ?? "native";
    claimStart = Number(b.claimStart); claimEnd = Number(b.claimEnd);
    adminWallet = b.adminWallet as string;
    eligibilityMode = ((b.eligibilityMode as string) ?? "csv") as "csv" | "rules";
    contractDropId = b.contractDropId ? Number(b.contractDropId) : null;
    contractAddress = (b.contractAddress as string) ?? null;
    ruleConfig = (b.ruleConfig as Record<string, unknown>) ?? null;
    if (Array.isArray(b.recipients))
      recipients = (b.recipients as Array<{ wallet: string; amount: string }>)
        .map(r => ({ wallet: r.wallet, amount: BigInt(r.amount) }));
  }

  if (!name) return res.status(400).json({ error: "name is required" });
  if (!adminWallet) return res.status(400).json({ error: "adminWallet is required" });
  if (csv) recipients = parseCsvRecipients(csv);
  if (eligibilityMode === "csv" && recipients.length === 0)
    return res.status(400).json({ error: "CSV or recipients required for csv mode" });

  let merkleRoot = "0".repeat(64);
  if (recipients.length > 0) merkleRoot = buildMerkleTree(recipients).root;

  const dropId = randomUUID();
  const totalAmount = recipients.reduce((s, r) => s + r.amount, 0n).toString()
    || (ruleConfig?.defaultAmount as string | undefined) || "0";

  insertDrop({ id: dropId, name, merkle_root: merkleRoot, token, total_amount: totalAmount,
    claim_start: claimStart, claim_end: claimEnd, admin_wallet: adminWallet,
    contract_drop_id: contractDropId, contract_address: contractAddress,
    eligibility_mode: eligibilityMode, rule_config: ruleConfig ? JSON.stringify(ruleConfig) : null });

  for (const r of recipients) insertRecipient(dropId, r.wallet, r.amount.toString());
  trackEvent("drop_created", dropId, adminWallet, { recipientCount: recipients.length });

  return res.status(201).json({ dropId, merkleRoot, totalAmount, recipientCount: recipients.length, claimStart, claimEnd });
}

function getDrop(req: VercelRequest, res: VercelResponse, id: string) {
  const drop = getDropById(id);
  if (!drop) return res.status(404).json({ error: "Drop not found", code: "NOT_FOUND" });
  const { total, claimed } = getDropStats(id);
  let ruleConfig = null;
  if (drop.rule_config) { try { ruleConfig = JSON.parse(drop.rule_config); } catch { /* ignore */ } }
  return res.json({ ...drop, ruleConfig, stats: { totalRecipients: total, claimedCount: claimed, claimRate: total ? claimed / total : 0 } });
}

function getDropRecipients(req: VercelRequest, res: VercelResponse, id: string) {
  return res.json({ recipients: getRecipients(id) });
}

async function checkEligibility(req: VercelRequest, res: VercelResponse, id: string, wallet: string) {
  const drop = getDropById(id);
  if (!drop) return res.status(404).json({ error: "Drop not found", code: "NOT_FOUND" });
  trackEvent("eligibility_check", id, wallet);

  if (drop.eligibility_mode === "rules") {
    const rules = JSON.parse(drop.rule_config ?? "{}");
    const result = await evaluateRules(wallet, rules);
    if (!result.eligible) return res.json({ eligible: false, reason: result.reason });
    const tree = buildMerkleTree([{ wallet, amount: BigInt(result.amount!) }]);
    return res.json({ eligible: true, amount: result.amount,
      proof: getMerkleProof(tree.layers, tree.leaves.get(wallet)!.leaf),
      merkleRoot: tree.root, contractDropId: drop.contract_drop_id, contractAddress: drop.contract_address });
  }

  const recipient = getRecipient(id, wallet);
  if (!recipient) return res.json({ eligible: false, reason: "Wallet not in recipient list" });
  const allRecipients = getRecipients(id).map(r => ({ wallet: r.wallet, amount: BigInt(r.amount) }));
  const tree = buildMerkleTree(allRecipients);
  const leafEntry = tree.leaves.get(wallet);
  if (!leafEntry) return res.json({ eligible: false, reason: "Wallet not found in Merkle tree" });

  return res.json({ eligible: true, amount: recipient.amount, alreadyClaimed: recipient.claimed === 1,
    proof: getMerkleProof(tree.layers, leafEntry.leaf),
    merkleRoot: drop.merkle_root, contractDropId: drop.contract_drop_id,
    contractAddress: drop.contract_address, claimStart: drop.claim_start,
    claimEnd: drop.claim_end, token: drop.token });
}

function recordClaim(req: VercelRequest, res: VercelResponse, id: string) {
  const { wallet, txHash } = req.body as { wallet?: string; txHash?: string };
  if (!wallet || !txHash) return res.status(400).json({ error: "wallet and txHash required" });
  markClaimed(id, wallet, txHash);
  trackEvent("claim_success", id, wallet, { txHash });
  return res.json({ ok: true });
}

function submitFeedback(req: VercelRequest, res: VercelResponse) {
  const { dropId, wallet, rating, comment } = req.body as { dropId?: string; wallet?: string; rating?: number; comment?: string };
  if (!dropId || !wallet || !rating) return res.status(400).json({ error: "dropId, wallet, rating required" });
  if (rating < 1 || rating > 5) return res.status(400).json({ error: "rating must be 1-5" });
  insertFeedback(dropId, wallet, rating, comment ?? null);
  trackEvent("feedback_submitted", dropId, wallet, { rating });
  return res.status(201).json({ ok: true });
}

function getAnalytics(req: VercelRequest, res: VercelResponse, dropId: string) {
  if (!getDropById(dropId)) return res.status(404).json({ error: "Drop not found" });
  return res.json({ dropId, claims: getClaimEvents(dropId),
    events: Object.entries(getEventCounts(dropId)).map(([event_type, count]) => ({ event_type, count })),
    feedback: getFeedbackStats(dropId) });
}

// ─── Router ────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  // Strip /api prefix added by Vercel
  const url = (req.url ?? "").replace(/^\/api/, "").split("?")[0];
  const method = req.method ?? "GET";

  try {
    // GET /health
    if (url === "/health" || url === "") return health(req, res);

    // POST /drops
    if (url === "/drops" && method === "POST") return await createDrop(req, res);

    // GET /drops/:id
    const dropMatch = url.match(/^\/drops\/([^/]+)$/);
    if (dropMatch && method === "GET") return getDrop(req, res, dropMatch[1]);

    // GET /drops/:id/recipients
    const recipientsMatch = url.match(/^\/drops\/([^/]+)\/recipients$/);
    if (recipientsMatch && method === "GET") return getDropRecipients(req, res, recipientsMatch[1]);

    // GET /drops/:id/eligibility/:wallet
    const eligibilityMatch = url.match(/^\/drops\/([^/]+)\/eligibility\/([^/]+)$/);
    if (eligibilityMatch && method === "GET") return await checkEligibility(req, res, eligibilityMatch[1], eligibilityMatch[2]);

    // POST /drops/:id/claims
    const claimsMatch = url.match(/^\/drops\/([^/]+)\/claims$/);
    if (claimsMatch && method === "POST") return recordClaim(req, res, claimsMatch[1]);

    // POST /feedback
    if (url === "/feedback" && method === "POST") return submitFeedback(req, res);

    // GET /analytics/:dropId
    const analyticsMatch = url.match(/^\/analytics\/([^/]+)$/);
    if (analyticsMatch && method === "GET") return getAnalytics(req, res, analyticsMatch[1]);

    return res.status(404).json({ error: "Not found" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
  }
}
