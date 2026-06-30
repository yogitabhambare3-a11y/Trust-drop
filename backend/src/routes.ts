import { Router } from "express";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import { db, trackEvent } from "./db.js";
import { evaluateRules } from "./lib/eligibility.js";
import {
  buildMerkleTree,
  getMerkleProof,
  parseCsvRecipients,
} from "./lib/merkle.js";
import { AppError, createDropSchema, feedbackSchema } from "./validation.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

export const dropsRouter = Router();

dropsRouter.post("/", upload.single("csv"), (req, res, next) => {
  try {
    let body = req.body;
    if (typeof body.recipients === "string") {
      body.recipients = JSON.parse(body.recipients);
    }
    if (typeof body.ruleConfig === "string") {
      body.ruleConfig = JSON.parse(body.ruleConfig);
    }
    body.claimStart = Number(body.claimStart);
    body.claimEnd = Number(body.claimEnd);
    if (body.contractDropId) body.contractDropId = Number(body.contractDropId);

    const parsed = createDropSchema.parse(body);
    const dropId = uuidv4();

    let recipients = parsed.recipients?.map((r: { wallet: string; amount: string }) => ({
      wallet: r.wallet,
      amount: BigInt(r.amount),
    }));

    if (req.file) {
      const csv = req.file.buffer.toString("utf8");
      recipients = parseCsvRecipients(csv);
    }

    if (parsed.eligibilityMode === "csv" && (!recipients || recipients.length === 0)) {
      throw new AppError(400, "CSV or recipients list required for csv mode", "MISSING_RECIPIENTS");
    }

    let merkleRoot = "0".repeat(64);
    let merkleLayers: Buffer[][] = [[Buffer.alloc(32)]];

    if (recipients && recipients.length > 0) {
      const tree = buildMerkleTree(recipients);
      merkleRoot = tree.root;
      merkleLayers = tree.layers;

      const insertRecipient = db.prepare(
        `INSERT INTO recipients (drop_id, wallet, amount) VALUES (?, ?, ?)`
      );
      const insertMany = db.transaction((rows: typeof recipients) => {
        for (const r of rows!) {
          insertRecipient.run(dropId, r.wallet, r.amount.toString());
        }
      });
      insertMany(recipients);
    }

    const totalAmount =
      recipients?.reduce((sum: bigint, r: { amount: bigint }) => sum + r.amount, 0n)?.toString() ??
      parsed.ruleConfig?.defaultAmount ??
      "0";

    db.prepare(
      `INSERT INTO drops (id, name, merkle_root, token, total_amount, claim_start, claim_end, admin_wallet, contract_drop_id, contract_address, eligibility_mode, rule_config)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      dropId,
      parsed.name,
      merkleRoot,
      parsed.token,
      totalAmount,
      parsed.claimStart,
      parsed.claimEnd,
      parsed.adminWallet,
      parsed.contractDropId ?? null,
      parsed.contractAddress ?? null,
      parsed.eligibilityMode,
      parsed.ruleConfig ? JSON.stringify(parsed.ruleConfig) : null
    );

    trackEvent("drop_created", dropId, parsed.adminWallet, { recipientCount: recipients?.length ?? 0 });

    res.status(201).json({
      dropId,
      merkleRoot,
      totalAmount,
      recipientCount: recipients?.length ?? 0,
      claimStart: parsed.claimStart,
      claimEnd: parsed.claimEnd,
    });
  } catch (err) {
    next(err);
  }
});

dropsRouter.get("/:id", (req, res, next) => {
  try {
    const drop = db.prepare(`SELECT * FROM drops WHERE id = ?`).get(req.params.id) as Record<string, unknown> | undefined;
    if (!drop) throw new AppError(404, "Drop not found", "NOT_FOUND");

    const stats = db
      .prepare(
        `SELECT COUNT(*) as total, SUM(CASE WHEN claimed = 1 THEN 1 ELSE 0 END) as claimed FROM recipients WHERE drop_id = ?`
      )
      .get(req.params.id) as { total: number; claimed: number };

    res.json({
      ...drop,
      ruleConfig: drop.rule_config ? JSON.parse(drop.rule_config as string) : null,
      stats: {
        totalRecipients: stats.total ?? 0,
        claimedCount: stats.claimed ?? 0,
        claimRate: stats.total ? (stats.claimed ?? 0) / stats.total : 0,
      },
    });
  } catch (err) {
    next(err);
  }
});

dropsRouter.get("/:id/recipients", (req, res, next) => {
  try {
    const rows = db
      .prepare(`SELECT wallet, amount, claimed, claim_tx_hash, claimed_at FROM recipients WHERE drop_id = ?`)
      .all(req.params.id);
    res.json({ recipients: rows });
  } catch (err) {
    next(err);
  }
});

dropsRouter.get("/:id/eligibility/:wallet", async (req, res, next) => {
  try {
    const { id, wallet } = req.params;
    const drop = db.prepare(`SELECT * FROM drops WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    if (!drop) throw new AppError(404, "Drop not found", "NOT_FOUND");

    trackEvent("eligibility_check", id, wallet);

    if (drop.eligibility_mode === "rules") {
      const rules = JSON.parse((drop.rule_config as string) ?? "{}");
      const result = await evaluateRules(wallet, rules);
      if (!result.eligible) {
        return res.json({ eligible: false, reason: result.reason });
      }
      const tree = buildMerkleTree([{ wallet, amount: BigInt(result.amount!) }]);
      return res.json({
        eligible: true,
        amount: result.amount,
        proof: getMerkleProof(tree.layers, tree.leaves.get(wallet)!.leaf).map((p: string) =>
          Buffer.from(p, "hex").toString("hex")
        ),
        merkleRoot: tree.root,
      });
    }

    const recipient = db
      .prepare(`SELECT * FROM recipients WHERE drop_id = ? AND wallet = ?`)
      .get(id, wallet) as { amount: string; claimed: number } | undefined;

    if (!recipient) {
      return res.json({ eligible: false, reason: "Wallet not in recipient list" });
    }

    const amount = BigInt(recipient.amount);
    const allRecipients = db
      .prepare(`SELECT wallet, amount FROM recipients WHERE drop_id = ?`)
      .all(id) as { wallet: string; amount: string }[];

    const tree = buildMerkleTree(
      allRecipients.map((r) => ({ wallet: r.wallet, amount: BigInt(r.amount) }))
    );
    const proof = getMerkleProof(tree.layers, tree.leaves.get(wallet)!.leaf);

    res.json({
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
  } catch (err) {
    next(err);
  }
});

dropsRouter.post("/:id/claims", (req, res, next) => {
  try {
    const { wallet, txHash } = req.body as { wallet?: string; txHash?: string };
    if (!wallet || !txHash) throw new AppError(400, "wallet and txHash required");

    db.prepare(
      `UPDATE recipients SET claimed = 1, claim_tx_hash = ?, claimed_at = strftime('%s','now') WHERE drop_id = ? AND wallet = ?`
    ).run(txHash, req.params.id, wallet);

    trackEvent("claim_success", req.params.id, wallet, { txHash });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export const feedbackRouter = Router();

feedbackRouter.post("/", (req, res, next) => {
  try {
    const parsed = feedbackSchema.parse(req.body);
    db.prepare(
      `INSERT INTO feedback (drop_id, wallet, rating, comment) VALUES (?, ?, ?, ?)`
    ).run(parsed.dropId, parsed.wallet, parsed.rating, parsed.comment ?? null);
    trackEvent("feedback_submitted", parsed.dropId, parsed.wallet, { rating: parsed.rating });
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export const analyticsRouter = Router();

analyticsRouter.get("/:dropId", (req, res, next) => {
  try {
    const dropId = req.params.dropId;
    const drop = db.prepare(`SELECT * FROM drops WHERE id = ?`).get(dropId);
    if (!drop) throw new AppError(404, "Drop not found");

    const claims = db
      .prepare(
        `SELECT wallet, claim_tx_hash, claimed_at FROM recipients WHERE drop_id = ? AND claimed = 1 ORDER BY claimed_at ASC`
      )
      .all(dropId);

    const events = db
      .prepare(
        `SELECT event_type, COUNT(*) as count FROM analytics_events WHERE drop_id = ? GROUP BY event_type`
      )
      .all(dropId);

    const feedback = db
      .prepare(`SELECT AVG(rating) as avgRating, COUNT(*) as count FROM feedback WHERE drop_id = ?`)
      .get(dropId) as { avgRating: number | null; count: number };

    res.json({
      dropId,
      claims,
      events,
      feedback: {
        averageRating: feedback.avgRating ?? 0,
        count: feedback.count,
      },
    });
  } catch (err) {
    next(err);
  }
});
