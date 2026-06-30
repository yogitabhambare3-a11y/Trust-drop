import { keccak256 } from "js-sha3";

export interface Recipient {
  wallet: string;
  amount: bigint;
}

/** Encode amount as 16-byte big-endian i128 to match Soroban. */
function amountToI128Be(amount: bigint): Buffer {
  const buf = Buffer.alloc(16);
  let v = amount;
  for (let i = 15; i >= 0; i--) {
    buf[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return buf;
}

/** Leaf hash must match Soroban contract: keccak256(wallet_utf8 || amount_i128_be) */
export function hashLeaf(wallet: string, amount: bigint): Buffer {
  const data = Buffer.concat([Buffer.from(wallet, "utf8"), amountToI128Be(amount)]);
  return Buffer.from(keccak256.arrayBuffer(data));
}

export function pairHash(a: Buffer, b: Buffer): Buffer {
  const [left, right] = Buffer.compare(a, b) <= 0 ? [a, b] : [b, a];
  return Buffer.from(keccak256.arrayBuffer(Buffer.concat([left, right])));
}

export interface MerkleTreeResult {
  root: string;
  leaves: Map<string, { amount: bigint; leaf: Buffer }>;
  layers: Buffer[][];
}

export function buildMerkleTree(recipients: Recipient[]): MerkleTreeResult {
  if (recipients.length === 0) {
    throw new Error("At least one recipient required");
  }

  const leaves = new Map<string, { amount: bigint; leaf: Buffer }>();
  let layer = recipients.map((r) => {
    const leaf = hashLeaf(r.wallet, r.amount);
    leaves.set(r.wallet, { amount: r.amount, leaf });
    return leaf;
  });

  const layers: Buffer[][] = [layer];

  while (layer.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      if (i + 1 < layer.length) {
        next.push(pairHash(layer[i], layer[i + 1]));
      } else {
        next.push(layer[i]);
      }
    }
    layer = next;
    layers.push(layer);
  }

  return {
    root: layer[0].toString("hex"),
    leaves,
    layers,
  };
}

export function getMerkleProof(
  layers: Buffer[][],
  targetLeaf: Buffer
): string[] {
  const proof: string[] = [];
  let index = layers[0].findIndex((l) => l.equals(targetLeaf));
  if (index === -1) {
    throw new Error("Leaf not found in tree");
  }

  for (let i = 0; i < layers.length - 1; i++) {
    const layer = layers[i];
    const isRight = index % 2 === 1;
    const siblingIndex = isRight ? index - 1 : index + 1;
    if (siblingIndex < layer.length) {
      proof.push(layer[siblingIndex].toString("hex"));
    }
    index = Math.floor(index / 2);
  }

  return proof;
}

export function parseCsvRecipients(csv: string): Recipient[] {
  const lines = csv
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];

  const start = lines[0].toLowerCase().includes("wallet") ? 1 : 0;
  const recipients: Recipient[] = [];

  for (let i = start; i < lines.length; i++) {
    const [wallet, amountStr] = lines[i].split(",").map((s) => s.trim());
    if (!wallet || !amountStr) continue;
    const amount = BigInt(amountStr);
    if (amount <= 0n) throw new Error(`Invalid amount on line ${i + 1}`);
    recipients.push({ wallet, amount });
  }

  return recipients;
}
