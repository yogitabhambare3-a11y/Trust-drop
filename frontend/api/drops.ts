import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomUUID } from "node:crypto";
import { insertDrop, insertRecipient, trackEvent } from "./_db.js";
import { buildMerkleTree, parseCsvRecipients } from "./_merkle.js";

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
        const headerEnd = part.indexOf("\r\n\r\n");
        if (headerEnd === -1) continue;
        const headers = part.slice(0, headerEnd).toString();
        const content = part.slice(headerEnd + 4);
        const nameMatch = headers.match(/name="([^"]+)"/);
        const filenameMatch = headers.match(/filename="([^"]+)"/);
        if (!nameMatch) continue;
        const fieldName = nameMatch[1];
        if (filenameMatch) { csv = content.toString("utf8"); }
        else { fields[fieldName] = content.toString("utf8").replace(/\r\n$/, ""); }
      }
      resolve({ fields, csv });
    });
    req.on("error", reject);
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
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
        const parsed = JSON.parse(fields.recipients) as Array<{ wallet: string; amount: string }>;
        recipients = parsed.map(r => ({ wallet: r.wallet, amount: BigInt(r.amount) }));
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
      if (Array.isArray(b.recipients)) {
        recipients = (b.recipients as Array<{ wallet: string; amount: string }>)
          .map(r => ({ wallet: r.wallet, amount: BigInt(r.amount) }));
      }
    }

    if (!name) return res.status(400).json({ error: "name is required" });
    if (!adminWallet) return res.status(400).json({ error: "adminWallet is required" });
    if (csv) recipients = parseCsvRecipients(csv);
    if (eligibilityMode === "csv" && recipients.length === 0) {
      return res.status(400).json({ error: "CSV or recipients required for csv mode" });
    }

    let merkleRoot = "0".repeat(64);
    if (recipients.length > 0) {
      const tree = buildMerkleTree(recipients);
      merkleRoot = tree.root;
    }

    const dropId = randomUUID();
    const totalAmount = recipients.reduce((s, r) => s + r.amount, 0n).toString()
      || (ruleConfig?.defaultAmount as string | undefined) || "0";

    insertDrop({ id: dropId, name, merkle_root: merkleRoot, token, total_amount: totalAmount,
      claim_start: claimStart, claim_end: claimEnd, admin_wallet: adminWallet,
      contract_drop_id: contractDropId, contract_address: contractAddress,
      eligibility_mode: eligibilityMode, rule_config: ruleConfig ? JSON.stringify(ruleConfig) : null });

    for (const r of recipients) {
      insertRecipient(dropId, r.wallet, r.amount.toString());
    }

    trackEvent("drop_created", dropId, adminWallet, { recipientCount: recipients.length });

    return res.status(201).json({ dropId, merkleRoot, totalAmount, recipientCount: recipients.length, claimStart, claimEnd });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
  }
}
