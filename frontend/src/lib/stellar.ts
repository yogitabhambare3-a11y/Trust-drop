import {
  Address,
  Contract,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  rpc,
} from "@stellar/stellar-sdk";

const NETWORK_PASSPHRASE = Networks.TESTNET;
const RPC_URL = import.meta.env.VITE_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";
const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS ?? "";

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
  return nativeToScVal(
    proof.map((hex) => hexToBytes(hex)),
    { type: "bytes" }
  );
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
  const account = await server.getAccount(params.sourcePublicKey);

  const op = contract.call(
    "claim",
    nativeToScVal(params.dropId, { type: "u64" }),
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
  if (msg.includes("AlreadyClaimed") || msg.includes("6")) {
    return "You have already claimed from this drop.";
  }
  if (msg.includes("ClaimNotStarted") || msg.includes("7")) {
    return "This drop has not opened yet.";
  }
  if (msg.includes("ClaimExpired") || msg.includes("8")) {
    return "The claim window for this drop has ended.";
  }
  if (msg.includes("InvalidProof") || msg.includes("5")) {
    return "You are not eligible for this drop.";
  }
  if (msg.includes("NotSignedIn") || msg.includes("User declined")) {
    return "Please approve the transaction in Freighter.";
  }
  return "Claim failed. Please try again or check your wallet balance.";
}
