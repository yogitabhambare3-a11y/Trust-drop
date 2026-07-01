import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDropById, getRecipients, getRecipient, trackEvent } from "../../../_db.js";
import { buildMerkleTree, getMerkleProof } from "../../../_merkle.js";
import { evaluateRules } from "../../../_eligibility.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).end();

  const { id, wallet } = req.query as { id: string; wallet: string };
  const drop = getDropById(id);
  if (!drop) return res.status(404).json({ error: "Drop not found", code: "NOT_FOUND" });

  trackEvent("eligibility_check", id, wallet);

  if (drop.eligibility_mode === "rules") {
    const rules = JSON.parse(drop.rule_config ?? "{}");
    const result = await evaluateRules(wallet, rules);
    if (!result.eligible) return res.json({ eligible: false, reason: result.reason });
    const tree = buildMerkleTree([{ wallet, amount: BigInt(result.amount!) }]);
    return res.json({
      eligible: true, amount: result.amount,
      proof: getMerkleProof(tree.layers, tree.leaves.get(wallet)!.leaf),
      merkleRoot: tree.root,
      contractDropId: drop.contract_drop_id,
      contractAddress: drop.contract_address,
    });
  }

  const recipient = getRecipient(id, wallet);
  if (!recipient) return res.json({ eligible: false, reason: "Wallet not in recipient list" });

  const allRecipients = getRecipients(id).map(r => ({ wallet: r.wallet, amount: BigInt(r.amount) }));
  const tree = buildMerkleTree(allRecipients);
  const leafEntry = tree.leaves.get(wallet);
  if (!leafEntry) return res.json({ eligible: false, reason: "Wallet not found in Merkle tree" });

  return res.json({
    eligible: true,
    amount: recipient.amount,
    alreadyClaimed: recipient.claimed === 1,
    proof: getMerkleProof(tree.layers, leafEntry.leaf),
    merkleRoot: drop.merkle_root,
    contractDropId: drop.contract_drop_id,
    contractAddress: drop.contract_address,
    claimStart: drop.claim_start,
    claimEnd: drop.claim_end,
    token: drop.token,
  });
}
