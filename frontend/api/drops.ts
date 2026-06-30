import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomUUID } from "node:crypto";
import { db, initDb, trackEvent } from "./_db.js";
import { buildMerkleTree, parseCsvRecipients } from "./_merkle.js";

async function parseMultipart(req: VercelRequest): Promise<{ fields: Record<string, string>; csv?: string }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString();
      const contentType = req.headers["content-type"] ?? "";

      if (contentType.includes("application/json")) {
        try { resolve({ fields: JSON.parse(body) }); } catch { reject(new Error("Invalid JSON")); }
        return;
      }

      if (contentType.includes("multipart/form-data")) {
        const boundary = contentType.split("boundary=")[1];
        if (!boundary) { reject(new Error("No boundary")); return; }

        const fields: Record<string, string> = {};
        let csv: string | undefined;

        const raw = Buffer.concat(chunks);
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
          const name = nameMatch[1];
          if (filenameMatch) {
            csv = content.toString("utf8");
          } else {
            fields[name] = content.toString("utf8").replace(/\r\n$/, "");
          }
        }
        resolve({ fields, csv });
        return;
      }

      // application/x-www-form-urlencoded fallback
      const fields: Record<string, string> = {};
      for (const [k, v] of new URLSearchParams(body)) fields[k] = v;
      resolve({ fields });
    });
    req.on("error", reject);
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  await initDb();

  if (req.method === "POST") {
    try {
      const { fields, csv } = await parseMultipart(req);

      const name = fields.name;
      const token = fields.token ?? "native";
      const claimStart = Number(fields.claimStart);
      const claimEnd = Number(fields.claimEnd);
      const adminWallet = fields.adminWallet;
      const eligibilityMode = (fields.eligibilityMode ?? "csv") as "csv" | "rules";
      const contractDropId = fields.contractDropId ? Number(fields.contractDropId) : null;
      const contractAddress = fields.contractAddress ?? null;
      const ruleConfig = fields.ruleConfig ? JSON.parse(fields.ruleConfig) : null;

      if (!name) return res.status(400).json({ error: "name is required", code: "MISSING_NAME" });
      if (!adminWallet) return res.status(400).json({ error: "adminWallet is required", code: "MISSING_WALLET" });

      let recipients: { wallet: string; amount: bigint }[] = [];

      if (csv) {
        recipients = parseCsvRecipients(csv);
      } else if (fields.recipients) {
        const parsed = JSON.parse(fields.recipients) as Array<{ wallet: string; amount: string }>;
        recipients = parsed.map((r) => ({ wallet: r.wallet, amount: BigInt(r.amount) }));
      }

      if (eligibilityMode === "csv" && recipients.length === 0) {
        return res.status(400).json({ error: "CSV or recipients required for csv mode", code: "MISSING_RECIPIENTS" });
      }

      let merkleRoot = "0".repeat(64);
      let merkleLayers: ReturnType<typeof import("./_merkle.js").buildMerkleTree>["layers"] = [];

      if (recipients.length > 0) {
        const tree = buildMerkleTree(recipients);
        merkleRoot = tree.root;
        merkleLayers = tree.layers;
      }

      const dropId = randomUUID();
      const totalAmount = recipients.reduce((s, r) => s + r.amount, 0n).toString() || ruleConfig?.defaultAmount || "0";

      await db.execute({
        sql: `INSERT INTO drops (id, name, merkle_root, token, total_amount, claim_start, claim_end, admin_wallet, contract_drop_id, contract_address, eligibility_mode, rule_config) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        args: [dropId, name, merkleRoot, token, totalAmount, claimStart, claimEnd, adminWallet, contractDropId, contractAddress, eligibilityMode, ruleConfig ? JSON.stringify(ruleConfig) : null],
      });

      if (recipients.length > 0) {
        for (const r of recipients) {
          await db.execute({
            sql: `INSERT OR IGNORE INTO recipients (drop_id, wallet, amount) VALUES (?,?,?)`,
            args: [dropId, r.wallet, r.amount.toString()],
          });
        }
        // Store merkle tree layers as JSON for later proof generation
        await db.execute({
          sql: `UPDATE drops SET rule_config = ? WHERE id = ? AND rule_config IS NULL`,
          args: [JSON.stringify({ _layers: merkleLayers.map(layer => layer.map(b => b.toString("hex"))) }), dropId],
        });
      }

      await trackEvent("drop_created", dropId, adminWallet, { recipientCount: recipients.length });

      return res.status(201).json({
        dropId,
        merkleRoot,
        totalAmount,
        recipientCount: recipients.length,
        claimStart,
        claimEnd,
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: err instanceof Error ? err.message : "Internal error", code: "INTERNAL_ERROR" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
