import {
  Address,
  Contract,
  Networks,
  Asset,
  TransactionBuilder,
  Operation,
  nativeToScVal,
  xdr,
  rpc,
} from "@stellar/stellar-sdk";

const NETWORK_PASSPHRASE = Networks.TESTNET;
const RPC_URL = import.meta.env.VITE_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";
const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS ?? "CAI7Y43Q5N54GOJWFC2PUE5TW7NGNI7REZVSSGFF2XW5WWJWLRQAY2PY";

export function getServer() {
  return new rpc.Server(RPC_URL, { allowHttp: true });
}

export function getContract(address = CONTRACT_ADDRESS) {
  if (!address) throw new Error("Contract address not configured");
  return new Contract(address);
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function proofToScVal(proof: string[]) {
  // Each proof element is BytesN<32> — build Vec<BytesN<32>> for Soroban
  const scVals = proof.map((hex) => xdr.ScVal.scvBytes(hexToBytes(hex)));
  return xdr.ScVal.scvVec(scVals);
}

export async function invokeClaim(params: {
  sourcePublicKey: string;
  signTransaction: (xdr: string) => Promise<string>;
  contractAddress: string;
  dropId: number;
  amount: string;
  proof: string[];
}) {
  const server = getServer();
  const contract = getContract(params.contractAddress);

  // Verify account exists on testnet before proceeding
  let account;
  try {
    account = await server.getAccount(params.sourcePublicKey);
  } catch {
    throw new Error(
      `Account ${params.sourcePublicKey.slice(0, 8)}... not found on Stellar Testnet. ` +
      `Fund it at https://friendbot.stellar.org/?addr=${params.sourcePublicKey}`
    );
  }

  const op = contract.call(
    "claim",
    nativeToScVal(BigInt(params.dropId), { type: "u64" }),
    Address.fromString(params.sourcePublicKey).toScVal(),
    nativeToScVal(BigInt(params.amount), { type: "i128" }),
    proofToScVal(params.proof)
  );

  const tx = new TransactionBuilder(account, {
    fee: "1000000",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(op)
    .setTimeout(180)
    .build();

  const prepared = await server.prepareTransaction(tx);
  const signedXdr = await params.signTransaction(prepared.toXDR());
  const signed = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);

  const result = await server.sendTransaction(signed);
  if (result.status === "ERROR") {
    throw new Error(result.errorResult?.toXDR("base64") ?? "Transaction failed");
  }

  let getTx = await server.getTransaction(result.hash);
  while (getTx.status === "NOT_FOUND") {
    await new Promise((r) => setTimeout(r, 1000));
    getTx = await server.getTransaction(result.hash);
  }

  if (getTx.status !== "SUCCESS") {
    throw new Error("Claim transaction failed on-chain");
  }

  return result.hash;
}

export function humanizeContractError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("AlreadyClaimed") || msg.includes("(6)") || msg.includes("code: 6")) {
    return "You have already claimed from this drop.";
  }
  if (msg.includes("ClaimNotStarted") || msg.includes("(7)") || msg.includes("code: 7")) {
    return "This drop has not opened yet.";
  }
  if (msg.includes("ClaimExpired") || msg.includes("(8)") || msg.includes("code: 8")) {
    return "The claim window for this drop has ended.";
  }
  if (msg.includes("InvalidProof") || msg.includes("(5)") || msg.includes("code: 5")) {
    return "Proof verification failed. The drop may not be funded on-chain yet, or the Merkle root doesn't match.";
  }
  if (msg.includes("DropNotFound") || msg.includes("(4)") || msg.includes("code: 4")) {
    return "Drop not found on-chain. The creator needs to call create_drop on the contract first.";
  }
  if (msg.includes("InsufficientContractBalance") || msg.includes("(9)") || msg.includes("code: 9")) {
    return "The contract has no tokens. The creator needs to fund the contract first.";
  }
  if (msg.includes("NotSignedIn") || msg.includes("User declined") || msg.includes("rejected")) {
    return "Transaction rejected. Please approve it in Freighter.";
  }
  if (msg.includes("Contract address not configured")) {
    return "Contract address not set. Please enter the contract address when creating your drop.";
  }
  return `Claim failed: ${msg.slice(0, 120)}`;
}

// ─── Create drop on-chain ─────────────────────────────────────────────────

export async function invokeCreateDrop(params: {
  sourcePublicKey: string;
  signTransaction: (xdr: string) => Promise<string>;
  contractAddress: string;
  dropId: number;
  merkleRoot: string;         // 64-char hex string
  tokenAddress: string;       // SAC contract address
  totalAmount: string;        // in stroops
  claimStart: number;
  claimEnd: number;
}) {
  const server = getServer();
  const contract = getContract(params.contractAddress);

  let account;
  try {
    account = await server.getAccount(params.sourcePublicKey);
  } catch {
    throw new Error(
      `Account not found on Stellar Testnet. Fund it at: ` +
      `https://friendbot.stellar.org/?addr=${params.sourcePublicKey}`
    );
  }

  // Convert 64-char hex merkle root to 32-byte Uint8Array
  const rootBytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    rootBytes[i] = parseInt(params.merkleRoot.slice(i * 2, i * 2 + 2), 16);
  }

  const op = contract.call(
    "create_drop",
    nativeToScVal(BigInt(params.dropId), { type: "u64" }),
    xdr.ScVal.scvBytes(rootBytes),
    Address.fromString(params.tokenAddress).toScVal(),
    nativeToScVal(BigInt(params.totalAmount), { type: "i128" }),
    nativeToScVal(BigInt(params.claimStart), { type: "u64" }),
    nativeToScVal(BigInt(params.claimEnd), { type: "u64" }),
    Address.fromString(params.sourcePublicKey).toScVal(),
  );

  const tx = new TransactionBuilder(account, {
    fee: "1000000",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(op)
    .setTimeout(180)
    .build();

  const prepared = await server.prepareTransaction(tx);
  const signedXdr = await params.signTransaction(prepared.toXDR());
  const signed = TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET);

  const result = await server.sendTransaction(signed);
  if (result.status === "ERROR") {
    throw new Error(result.errorResult?.toXDR("base64") ?? "create_drop transaction failed");
  }

  // Poll for confirmation
  let getTx = await server.getTransaction(result.hash);
  let attempts = 0;
  while (getTx.status === "NOT_FOUND" && attempts < 30) {
    await new Promise((r) => setTimeout(r, 1000));
    getTx = await server.getTransaction(result.hash);
    attempts++;
  }

  if (getTx.status !== "SUCCESS") {
    const err = (getTx as { resultXdr?: { toXDR?: (enc: string) => string } }).resultXdr?.toXDR?.("base64") ?? "create_drop failed on-chain";
    throw new Error(err);
  }

  return result.hash;
}

// ─── Fund contract with XLM ───────────────────────────────────────────────

export async function fundContract(params: {
  sourcePublicKey: string;
  signTransaction: (xdr: string) => Promise<string>;
  contractAddress: string;
  amountXlm: string;   // e.g. "100" for 100 XLM
}) {
  const server = getServer();

  let account;
  try {
    account = await server.getAccount(params.sourcePublicKey);
  } catch {
    throw new Error(
      `Account not found on Stellar Testnet. Fund it at: ` +
      `https://friendbot.stellar.org/?addr=${params.sourcePublicKey}`
    );
  }

  const tx = new TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({
        destination: params.contractAddress,
        asset: Asset.native(),
        amount: params.amountXlm,
      })
    )
    .setTimeout(180)
    .build();

  const signedXdr = await params.signTransaction(tx.toXDR());
  const signed = TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET);

  const result = await server.sendTransaction(signed);
  if (result.status === "ERROR") {
    throw new Error("Payment transaction failed");
  }

  let getTx = await server.getTransaction(result.hash);
  let attempts = 0;
  while (getTx.status === "NOT_FOUND" && attempts < 30) {
    await new Promise((r) => setTimeout(r, 1000));
    getTx = await server.getTransaction(result.hash);
    attempts++;
  }

  if (getTx.status !== "SUCCESS") {
    throw new Error("Funding transaction failed on-chain");
  }

  return result.hash;
}
