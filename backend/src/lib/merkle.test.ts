import { describe, expect, it } from "vitest";
import {
  buildMerkleTree,
  getMerkleProof,
  hashLeaf,
  pairHash,
  parseCsvRecipients,
} from "./merkle.js";

describe("merkle", () => {
  it("builds tree and generates valid proof for single recipient", () => {
    const recipients = [{ wallet: "GABC123", amount: 100n }];
    const tree = buildMerkleTree(recipients);
    const leaf = tree.leaves.get("GABC123")!.leaf;
    const proof = getMerkleProof(tree.layers, leaf);
    expect(proof).toEqual([]);
    expect(tree.root).toBe(leaf.toString("hex"));
  });

  it("builds tree for multiple recipients", () => {
    const recipients = [
      { wallet: "GAAA", amount: 100n },
      { wallet: "GBBB", amount: 200n },
    ];
    const tree = buildMerkleTree(recipients);
    expect(tree.root).toHaveLength(64);
    for (const r of recipients) {
      const leaf = tree.leaves.get(r.wallet)!.leaf;
      const proof = getMerkleProof(tree.layers, leaf);
      expect(Array.isArray(proof)).toBe(true);
    }
  });

  it("pairHash is commutative", () => {
    const a = hashLeaf("GAAA", 1n);
    const b = hashLeaf("GBBB", 2n);
    expect(pairHash(a, b).equals(pairHash(b, a))).toBe(true);
  });

  it("parses CSV with header", () => {
    const csv = "wallet,amount\nGAAA,100\nGBBB,200";
    const r = parseCsvRecipients(csv);
    expect(r).toHaveLength(2);
    expect(r[0].amount).toBe(100n);
  });
});
