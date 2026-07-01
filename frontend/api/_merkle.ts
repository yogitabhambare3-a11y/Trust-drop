import { keccak_256 } from "@noble/hashes/sha3";

export interface Recipient {
  wallet: string;
  amount: bigint;
}

function amountToI128Be(amount: bigint): Uint8Array {
  const buf = new Uint8Array(16);
  let v = amount;
  for (let i = 15; i >= 0; i--) {
    buf[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return buf;
}

function keccak256(data: Uint8Array): Buffer {
  return Buffer.from(keccak_256(data));
}

export function hashLeaf(wallet: string, amount: bigint): Buffer {
  const walletBytes = Buffer.from(wallet, "utf8");
  const amountBytes = amountToI128Be(amount);
  const data = new Uint8Array(walletBytes.length + amountBytes.length);
  data.set(walletBytes, 0);
  data.set(amountBytes, walletBytes.length);
  return keccak256(data);
}

export function pairHash(a: Buffer, b: Buffer): Buffer {
  const [left, right] = Buffer.compare(a, b) <= 0 ? [a, b] : [b, a];
  const data = new Uint8Array(left.length + right.length);
  data.set(left, 0);
  data.set(right, left.length);
  return keccak256(data);
}

export interface MerkleTreeResult {
  root: string;
  leaves: Map<string, { amount: bigint; leaf: Buffer }>;
  layers: Buffer[][];
}

export function buildMerkleTree(recipients: Recipient[]): MerkleTreeResult {
  if (recipients.length === 0) throw new Error("At least one recipient required");

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
      next.push(i + 1 < layer.length ? pairHash(layer[i], layer[i + 1]) : layer[i]);
    }
    layer = next;
    layers.push(layer);
  }

  return { root: layer[0].toString("hex"), leaves, layers };
}

export function getMerkleProof(layers: Buffer[][], targetLeaf: Buffer): string[] {
  const proof: string[] = [];
  let index = layers[0].findIndex((l) => l.equals(targetLeaf));
  if (index === -1) throw new Error("Leaf not found in tree");

  for (let i = 0; i < layers.length - 1; i++) {
    const layer = layers[i];
    const siblingIndex = index % 2 === 1 ? index - 1 : index + 1;
    if (siblingIndex < layer.length) proof.push(layer[siblingIndex].toString("hex"));
    index = Math.floor(index / 2);
  }
  return proof;
}

export function parseCsvRecipients(csv: string): Recipient[] {
  const lines = csv.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const start = lines[0].toLowerCase().includes("wallet") ? 1 : 0;
  const recipients: Recipient[] = [];
  for (let i = start; i < lines.length; i++) {
    const [wallet, amountStr] = lines[i].split(",").map((s) => s.trim());
    if (!wallet || !amountStr) continue;
    recipients.push({ wallet, amount: BigInt(amountStr) });
  }
  return recipients;
}
