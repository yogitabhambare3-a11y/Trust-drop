import type { VercelRequest, VercelResponse } from "@vercel/node";
import { db, initDb, trackEvent } from "../../../_db.js";
import { buildMerkleTree, getMerkleProof } from "../../../_merkle.js";
import { evaluateRules } from "../../../_eligibility.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).end();

  await initDb();
  const { id, wallet } = req.query as { id: string; wallet: string };

  const dropRow = await db.execute({ sql: `SELECT * FROM drops WHERE id = ?`, args: [id] });
  if (dropRow.rows.length === 0) return res.status(404).json({ error: "Drop not found", code: "NOT_FOUND" });
  const drop = dropRow.rows[0];

  await trackEvent("eligibility_check", id, wallet);

  if (drop.eligibility_mode === "rules") {
    const rules = JSON.parse((drop.rule_config as string) ?? "{}");
    const result = await evaluateRules(wallet, rules);
    if (!result.eligible) return res.json({ eligible: false, reason: result.reason });
    const tree = buildMerkleTree([{ wallet, amount: BigInt(result.amount!) }]);
    return res.json({
      eligible: true,
      amount: result.amount,
      proof: getMerkleProof(tree.layers, tree.leaves.get(wallet)!.leaf),
      merkleRoot: tree.root,
      contractDropId: drop.contract_drop_id,
      contractAddress: drop.contract_address,
    });
  }

  // CSV mode: look up recipient and rebuild proof from all recipients
  const recipientRow = await db.execute({
    sql: `SELECT * FROM recipients WHERE drop_id = ? AND wallet = ?`,
    args: [id, wallet],
  });
  if (recipientRow.rows.length === 0) return res.json({ eligible: false, reason: "Wallet not in recipient list" });
  const recipient = recipientRow.rows[0];

  const allRows = await db.execute({
    sql: `SELECT wallet, amount FROM recipients WHERE drop_id = ?`,
    args: [id],
  });
  const allRecipients = allRows.rows.map((r) => ({ wallet: r.wallet as string, amount: BigInt(r.amount as string) }));
  const tree = buildMerkleTree(allRecipients);
  const leafEntry = tree.leaves.get(wallet);
  if (!leafEntry) return res.json({ eligible: false, reason: "Wallet not found in Merkle tree" });
  const proof = getMerkleProof(tree.layers, leafEntry.leaf);

  return res.json({
    eligible: true,
    amount: recipient.amount,
    alreadyClaimed: recipient.claimed === 1,
    proof,
    merkleRoot: drop.merkle_root,
    contractDropId: drop.contract_drop_id,
    contractAddress: drop.contract_address,
    claimStart: drop.claim_start,
    claimEnd: drop.claim_end,
    token: drop.token,
  });
}
