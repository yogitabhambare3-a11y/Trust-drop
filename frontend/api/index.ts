/**
 * TrustDrop unified API handler.
 * Single function handles all routes — shares state within warm lambda instance.
 * Uses Turso (persistent) when TURSO_DATABASE_URL is set, /tmp JSON otherwise.
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
  const mode = process.env.TURSO_DATABASE_URL ? "turso (persistent)" : "tmp (ephemeral)";
  return res.json({ status: "ok", service: "trustdrop-api", db: mode });
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
    if (fields.recipients)
      recipients = (JSON.parse(fields.recipients) as Array<{ wallet: string; amount: string }>)
        .map(r => ({ wallet: r.wallet, amount: BigInt(r.amount) }));
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

  await insertDrop({ id: dropId, name, merkle_root: merkleRoot, token, total_amount: totalAmount,
    claim_start: claimStart, claim_end: claimEnd, admin_wallet: adminWallet,
    contract_drop_id: contractDropId, contract_address: contractAddress,
    eligibility_mode: eligibilityMode, rule_config: ruleConfig ? JSON.stringify(ruleConfig) : null });

  for (const r of recipients) await insertRecipient(dropId, r.wallet, r.amount.toString());
  await trackEvent("drop_created", dropId, adminWallet, { recipientCount: recipients.length });

  return res.status(201).json({ dropId, merkleRoot, totalAmount, recipientCount: recipients.length, claimStart, claimEnd });
}

async function getDrop(req: VercelRequest, res: VercelResponse, id: string) {
  const drop = await getDropById(id);
  if (!drop) return res.status(404).json({ error: "Drop not found", code: "NOT_FOUND" });
  const { total, claimed } = await getDropStats(id);
  let ruleConfig = null;
  if (drop.rule_config) { try { ruleConfig = JSON.parse(drop.rule_config); } catch { /* ignore */ } }
  return res.json({ ...drop, ruleConfig,
    stats: { totalRecipients: total, claimedCount: claimed, claimRate: total ? claimed / total : 0 } });
}

async function getDropRecipients(req: VercelRequest, res: VercelResponse, id: string) {
  return res.json({ recipients: await getRecipients(id) });
}

async function checkEligibility(req: VercelRequest, res: VercelResponse, id: string, wallet: string) {
  const drop = await getDropById(id);
  if (!drop) return res.status(404).json({ error: "Drop not found", code: "NOT_FOUND" });
  await trackEvent("eligibility_check", id, wallet);

  if (drop.eligibility_mode === "rules") {
    const rules = JSON.parse(drop.rule_config ?? "{}");
    const result = await evaluateRules(wallet, rules);
    if (!result.eligible) return res.json({ eligible: false, reason: result.reason });
    const tree = buildMerkleTree([{ wallet, amount: BigInt(result.amount!) }]);
    return res.json({ eligible: true, amount: result.amount,
      proof: getMerkleProof(tree.layers, tree.leaves.get(wallet)!.leaf),
      merkleRoot: tree.root, contractDropId: drop.contract_drop_id,
      contractAddress: drop.contract_address });
  }

  const recipient = await getRecipient(id, wallet);
  if (!recipient) return res.json({ eligible: false, reason: "Wallet not in recipient list" });

  const allRecipients = (await getRecipients(id)).map(r => ({ wallet: r.wallet, amount: BigInt(r.amount) }));
  const tree = buildMerkleTree(allRecipients);
  const leafEntry = tree.leaves.get(wallet);
  if (!leafEntry) return res.json({ eligible: false, reason: "Wallet not found in Merkle tree" });

  return res.json({ eligible: true, amount: recipient.amount,
    alreadyClaimed: Number(recipient.claimed) === 1,
    proof: getMerkleProof(tree.layers, leafEntry.leaf),
    merkleRoot: drop.merkle_root, contractDropId: drop.contract_drop_id,
    contractAddress: drop.contract_address, claimStart: drop.claim_start,
    claimEnd: drop.claim_end, token: drop.token });
}

async function recordClaim(req: VercelRequest, res: VercelResponse, id: string) {
  const { wallet, txHash } = req.body as { wallet?: string; txHash?: string };
  if (!wallet || !txHash) return res.status(400).json({ error: "wallet and txHash required" });
  await markClaimed(id, wallet, txHash);
  await trackEvent("claim_success", id, wallet, { txHash });
  return res.json({ ok: true });
}

async function submitFeedback(req: VercelRequest, res: VercelResponse) {
  const { dropId, wallet, rating, comment } = req.body as
    { dropId?: string; wallet?: string; rating?: number; comment?: string };
  if (!dropId || !wallet || !rating) return res.status(400).json({ error: "dropId, wallet, rating required" });
  if (rating < 1 || rating > 5) return res.status(400).json({ error: "rating must be 1-5" });
  await insertFeedback(dropId, wallet, rating, comment ?? null);
  await trackEvent("feedback_submitted", dropId, wallet, { rating });
  return res.status(201).json({ ok: true });
}

async function getAnalytics(req: VercelRequest, res: VercelResponse, dropId: string) {
  if (!await getDropById(dropId)) return res.status(404).json({ error: "Drop not found" });
  return res.json({ dropId,
    claims: await getClaimEvents(dropId),
    events: Object.entries(await getEventCounts(dropId)).map(([event_type, count]) => ({ event_type, count })),
    feedback: await getFeedbackStats(dropId) });
}

// ─── Router ────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const url = (req.url ?? "").replace(/^\/api/, "").split("?")[0];
  const method = req.method ?? "GET";

  try {
    if (url === "/health" || url === "") return health(req, res);
    if (url === "/drops" && method === "POST") return await createDrop(req, res);

    const dropOnly = url.match(/^\/drops\/([^/]+)$/);
    if (dropOnly && method === "GET") return await getDrop(req, res, dropOnly[1]);

    const recipients = url.match(/^\/drops\/([^/]+)\/recipients$/);
    if (recipients && method === "GET") return await getDropRecipients(req, res, recipients[1]);

    const eligibility = url.match(/^\/drops\/([^/]+)\/eligibility\/([^/]+)$/);
    if (eligibility && method === "GET") return await checkEligibility(req, res, eligibility[1], decodeURIComponent(eligibility[2]));

    const claims = url.match(/^\/drops\/([^/]+)\/claims$/);
    if (claims && method === "POST") return await recordClaim(req, res, claims[1]);

    if (url === "/feedback" && method === "POST") return await submitFeedback(req, res);

    const analytics = url.match(/^\/analytics\/([^/]+)$/);
    if (analytics && method === "GET") return await getAnalytics(req, res, analytics[1]);

    return res.status(404).json({ error: "Not found" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
  }
}
