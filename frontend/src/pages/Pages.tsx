import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { signTransaction } from "@stellar/freighter-api";
import { Networks } from "@stellar/stellar-sdk";
import { useWallet } from "../context/WalletContext";
import { checkEligibility, createDrop, getDrop, getRecipients, recordClaim, type Drop } from "../lib/api";
import { FeedbackWidget } from "../components/FeedbackWidget";
import { useToast } from "../components/Toast";
import { invokeClaim, invokeCreateDrop, fundContract, humanizeContractError } from "../lib/stellar";
import posthog from "posthog-js";

type ClaimState = "idle" | "checking" | "submitting" | "pending" | "confirmed" | "failed";

export function CreatorPanel() {
  const { publicKey } = useWallet();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [token, setToken] = useState("native");
  const [claimStart, setClaimStart] = useState("");
  const [claimEnd, setClaimEnd] = useState("");
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [minTxCount, setMinTxCount] = useState("");
  const [minAgeDays, setMinAgeDays] = useState("");
  const [mode, setMode] = useState<"csv" | "rules">("csv");
  const [contractDropId, setContractDropId] = useState("1");
  const [contractAddress, setContractAddress] = useState(
    import.meta.env.VITE_CONTRACT_ADDRESS ?? "CAI7Y43Q5N54GOJWFC2PUE5TW7NGNI7REZVSSGFF2XW5WWJWLRQAY2PY"
  );
  const [creating, setCreating] = useState(false);
  const [dropId, setDropId] = useState<string | null>(null);
  const [merkleRoot, setMerkleRoot] = useState<string | null>(null);
  const [totalAmount, setTotalAmount] = useState<string | null>(null);
  const [onchainStep, setOnchainStep] = useState<
    "idle" | "registering" | "funding" | "done" | "error"
  >("idle");
  const [onchainTx, setOnchainTx] = useState<{ register?: string; fund?: string }>({});
  const [drop, setDrop] = useState<Drop | null>(null);
  const [recipients, setRecipients] = useState<Array<{ wallet: string; amount: string; claimed: number }>>([]);
  const [loadingDrop, setLoadingDrop] = useState(false);

  const loadDrop = async (id: string) => {
    setLoadingDrop(true);
    try {
      const [d, r] = await Promise.all([getDrop(id), getRecipients(id)]);
      setDrop(d);
      setRecipients(r.recipients);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to load drop", "error");
    } finally {
      setLoadingDrop(false);
    }
  };

  useEffect(() => {
    if (dropId) loadDrop(dropId);
  }, [dropId]);

  const handleCreate = async () => {
    if (!publicKey) {
      toast("Connect Freighter first", "error");
      return;
    }
    setCreating(true);
    try {
      const fd = new FormData();
      fd.append("name", name);
      fd.append("token", token);
      fd.append("claimStart", String(Math.floor(new Date(claimStart).getTime() / 1000)));
      fd.append("claimEnd", String(Math.floor(new Date(claimEnd).getTime() / 1000)));
      fd.append("adminWallet", publicKey);
      fd.append("eligibilityMode", mode);
      fd.append("contractAddress", contractAddress);
      fd.append("contractDropId", contractDropId);
      if (mode === "rules") {
        fd.append(
          "ruleConfig",
          JSON.stringify({
            minTxCount: minTxCount ? Number(minTxCount) : undefined,
            minAccountAgeDays: minAgeDays ? Number(minAgeDays) : undefined,
            defaultAmount: "1000000000",
          })
        );
      }
      if (csvFile) fd.append("csv", csvFile);

      const result = await createDrop(fd);
      setDropId(result.dropId);
      setMerkleRoot(result.merkleRoot);
      setTotalAmount(result.totalAmount);
      setOnchainStep("idle");
      posthog.capture("drop_created", { dropId: result.dropId, recipients: result.recipientCount });
      toast(`Drop created! Now register it on-chain.`, "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Create failed", "error");
    } finally {
      setCreating(false);
    }
  };

  const handleRegisterOnchain = async () => {
    if (!publicKey || !merkleRoot || !totalAmount) return;
    setOnchainStep("registering");
    try {
      // Step 1 — call create_drop on the Soroban contract
      const registerTx = await invokeCreateDrop({
        sourcePublicKey: publicKey,
        signTransaction: async (xdr) => {
          const signed = await signTransaction(xdr, { networkPassphrase: Networks.TESTNET });
          if (signed.error) throw new Error(String(signed.error));
          return signed.signedTxXdr;
        },
        contractAddress,
        dropId: Number(contractDropId),
        merkleRoot,
        tokenAddress: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
        totalAmount,
        claimStart: claimStart ? Math.floor(new Date(claimStart).getTime() / 1000) : 1000000,
        claimEnd: claimEnd ? Math.floor(new Date(claimEnd).getTime() / 1000) : 9999999999,
      });
      setOnchainTx((t) => ({ ...t, register: registerTx }));
      toast("✅ Drop registered on-chain! Now funding…", "success");

      // Step 2 — send XLM to the contract
      setOnchainStep("funding");
      const xlmAmount = (Number(totalAmount) / 10_000_000).toFixed(7);
      const fundTx = await fundContract({
        sourcePublicKey: publicKey,
        signTransaction: async (xdr) => {
          const signed = await signTransaction(xdr, { networkPassphrase: Networks.TESTNET });
          if (signed.error) throw new Error(String(signed.error));
          return signed.signedTxXdr;
        },
        contractAddress,
        amountXlm: xlmAmount,
      });
      setOnchainTx((t) => ({ ...t, fund: fundTx }));
      setOnchainStep("done");
      posthog.capture("drop_funded", { dropId, registerTx, fundTx });
      toast("🎉 Drop is live! Share the claim link.", "success");
      if (dropId) loadDrop(dropId);
    } catch (e) {
      setOnchainStep("error");
      const msg = e instanceof Error ? e.message : "On-chain registration failed";
      toast(msg, "error");
    }
  };

  const exportCsv = () => {
    const header = "wallet,amount,claimed\n";
    const rows = recipients
      .map((r) => `${r.wallet},${r.amount},${r.claimed ? "yes" : "no"}`)
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trustdrop-${dropId}.csv`;
    a.click();
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white sm:text-3xl">Creator Panel</h1>
        <p className="mt-2 text-slate-400">Configure, fund, and monitor your airdrop.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card space-y-4">
          <h2 className="font-semibold">New Drop</h2>
          <input className="input" placeholder="Drop name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="input" placeholder="Token (native or contract address)" value={token} onChange={(e) => setToken(e.target.value)} />
          <div className="grid gap-3 sm:grid-cols-2">
            <input className="input" type="datetime-local" value={claimStart} onChange={(e) => setClaimStart(e.target.value)} />
            <input className="input" type="datetime-local" value={claimEnd} onChange={(e) => setClaimEnd(e.target.value)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <input className="input" placeholder="Contract address" value={contractAddress} onChange={(e) => setContractAddress(e.target.value)} />
            <input className="input" placeholder="Contract drop ID (e.g. 1)" value={contractDropId} onChange={(e) => setContractDropId(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <button type="button" className={mode === "csv" ? "btn-primary" : "btn-secondary"} onClick={() => setMode("csv")}>
              CSV upload
            </button>
            <button type="button" className={mode === "rules" ? "btn-primary" : "btn-secondary"} onClick={() => setMode("rules")}>
              Rule-based
            </button>
          </div>
          {mode === "csv" ? (
            <input type="file" accept=".csv" className="input" onChange={(e) => setCsvFile(e.target.files?.[0] ?? null)} />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <input className="input" placeholder="Min tx count" value={minTxCount} onChange={(e) => setMinTxCount(e.target.value)} />
              <input className="input" placeholder="Min account age (days)" value={minAgeDays} onChange={(e) => setMinAgeDays(e.target.value)} />
            </div>
          )}
          <button type="button" className="btn-primary w-full" disabled={creating || !name} onClick={handleCreate}>
            {creating ? "Creating…" : "Create drop"}
          </button>
        </div>

        <div className="card space-y-4">
          <h2 className="font-semibold">
            {onchainStep === "done" ? "✅ Drop is live!" : "Register on-chain"}
          </h2>

          {!dropId ? (
            <p className="text-sm text-slate-400">
              Create a drop first, then register it on the Soroban contract and fund it — all in one click.
            </p>
          ) : onchainStep === "done" ? (
            <div className="space-y-3 text-sm">
              <p className="text-emerald-300 font-medium">Both transactions confirmed ✅</p>
              {onchainTx.register && (
                <div>
                  <p className="text-slate-500 text-xs">Register TX</p>
                  <a
                    href={`https://stellar.expert/explorer/testnet/tx/${onchainTx.register}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-xs text-brand-400 hover:underline break-all"
                  >
                    {onchainTx.register.slice(0, 32)}…
                  </a>
                </div>
              )}
              {onchainTx.fund && (
                <div>
                  <p className="text-slate-500 text-xs">Fund TX</p>
                  <a
                    href={`https://stellar.expert/explorer/testnet/tx/${onchainTx.fund}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-xs text-brand-400 hover:underline break-all"
                  >
                    {onchainTx.fund.slice(0, 32)}…
                  </a>
                </div>
              )}
              <div className="rounded-lg bg-slate-800 p-3">
                <p className="text-xs text-slate-400 mb-1">Claim link — share this:</p>
                <p className="font-mono text-xs text-brand-300 break-all">
                  {window.location.origin}/claim?drop={dropId}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {drop && (
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-500">Merkle root</dt>
                    <dd className="font-mono text-xs text-slate-300">{drop.merkle_root.slice(0, 20)}…</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-500">Total amount</dt>
                    <dd className="text-slate-300">{drop.total_amount} stroops</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-500">Recipients</dt>
                    <dd className="text-slate-300">{drop.stats.totalRecipients}</dd>
                  </div>
                </dl>
              )}

              <div className="rounded-lg border border-amber-800 bg-amber-950/30 p-3 text-xs text-amber-300">
                <p className="font-semibold mb-1">Two Freighter approvals needed:</p>
                <p>1️⃣ Register drop on Soroban contract</p>
                <p>2️⃣ Send XLM tokens to contract</p>
              </div>

              {onchainStep === "error" && (
                <p className="text-xs text-red-400">
                  ⚠️ Failed. Make sure your wallet is the contract admin and has enough XLM.
                </p>
              )}

              <button
                type="button"
                className="btn-primary w-full"
                disabled={!publicKey || onchainStep === "registering" || onchainStep === "funding"}
                onClick={handleRegisterOnchain}
              >
                {onchainStep === "registering"
                  ? "⏳ Registering on-chain…"
                  : onchainStep === "funding"
                    ? "⏳ Funding contract…"
                    : onchainStep === "error"
                      ? "Retry register & fund"
                      : "🚀 Register & Fund on-chain"}
              </button>
            </div>
          )}
        </div>
      </div>

      {dropId && (
        <div className="card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold">Dashboard</h2>
            <button type="button" className="btn-secondary text-xs" onClick={exportCsv}>
              Export CSV
            </button>
          </div>
          {loadingDrop || !drop ? (
            <div className="mt-4 space-y-2">
              <div className="skeleton h-4 w-full" />
              <div className="skeleton h-4 w-3/4" />
            </div>
          ) : (
            <>
              <div className="mt-4">
                <div className="mb-1 flex justify-between text-sm">
                  <span>Claim progress</span>
                  <span>
                    {drop.stats.claimedCount} / {drop.stats.totalRecipients} (
                    {Math.round(drop.stats.claimRate * 100)}%)
                  </span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full rounded-full bg-brand-500 transition-all"
                    style={{ width: `${drop.stats.claimRate * 100}%` }}
                  />
                </div>
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[480px] text-left text-sm">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="py-2">Wallet</th>
                      <th>Amount</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recipients.slice(0, 50).map((r) => (
                      <tr key={r.wallet} className="border-t border-slate-800">
                        <td className="py-2 font-mono text-xs">{r.wallet.slice(0, 12)}…</td>
                        <td>{r.amount}</td>
                        <td>{r.claimed ? "✅ Claimed" : "⏳ Pending"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs text-slate-500">
                Claim link:{" "}
                <span className="text-brand-300 break-all">
                  {window.location.origin}/claim?drop={dropId}
                </span>
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function ClaimerPage() {
  const [params] = useSearchParams();
  const dropParam = params.get("drop") ?? "";
  const [dropId, setDropId] = useState(dropParam);
  const { publicKey, connect, connecting } = useWallet();
  const { toast } = useToast();
  const [claimState, setClaimState] = useState<ClaimState>("idle");
  const [eligibility, setEligibility] = useState<Awaited<ReturnType<typeof checkEligibility>> | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!publicKey || !dropId) return;
    setClaimState("checking");
    setEligibility(null);
    checkEligibility(dropId, publicKey)
      .then((res) => {
        setEligibility(res);
        setClaimState("idle");
        posthog.capture("eligibility_checked", { eligible: res.eligible, dropId });
      })
      .catch((e) => {
        setErrorMsg(e instanceof Error ? e.message : "Eligibility check failed");
        setClaimState("failed");
      });
  }, [publicKey, dropId]);

  const handleClaim = async () => {
    if (!publicKey || !eligibility?.eligible || !eligibility.proof) return;
    setClaimState("submitting");
    setErrorMsg(null);
    posthog.capture("claim_attempt", { dropId });

    try {
      setClaimState("pending");
      const hash = await invokeClaim({
        sourcePublicKey: publicKey,
        signTransaction: async (xdr) => {
          const signed = await signTransaction(xdr, { networkPassphrase: Networks.TESTNET });
          if (signed.error) throw new Error(String(signed.error));
          return signed.signedTxXdr;
        },
        contractAddress: eligibility.contractAddress ?? import.meta.env.VITE_CONTRACT_ADDRESS,
        dropId: eligibility.contractDropId ?? 1,
        amount: eligibility.amount!,
        proof: eligibility.proof,
      }).catch((e) => {
        throw new Error(humanizeContractError(e));
      });

      await recordClaim(dropId, publicKey, hash);
      setTxHash(hash);
      setClaimState("confirmed");
      posthog.capture("claim_success", { dropId, txHash: hash });
      toast("Claim confirmed on-chain!", "success");
    } catch (e) {
      const msg = humanizeContractError(e);
      setErrorMsg(msg);
      setClaimState("failed");
      posthog.capture("claim_failed", { dropId, error: msg });
      toast(msg, "error");
    }
  };

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-white sm:text-3xl">Claim your drop</h1>
        <p className="mt-2 text-slate-400">Connect Freighter and claim in one click.</p>
      </div>

      <div className="card space-y-4">
        <label className="block text-sm text-slate-400">Drop ID</label>
        <input className="input" value={dropId} onChange={(e) => setDropId(e.target.value)} placeholder="Paste drop UUID" />

        {!publicKey ? (
          <button type="button" className="btn-primary w-full" onClick={connect} disabled={connecting}>
            {connecting ? "Connecting…" : "Connect Freighter wallet"}
          </button>
        ) : (
          <p className="text-center text-xs text-slate-400">Connected: {publicKey.slice(0, 16)}…</p>
        )}

        {claimState === "checking" && (
          <div className="space-y-2">
            <div className="skeleton h-4 w-full" />
            <div className="skeleton h-4 w-2/3" />
            <p className="text-center text-sm text-slate-500">Checking eligibility…</p>
          </div>
        )}

        {eligibility && claimState !== "checking" && (
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm">
            {eligibility.eligible ? (
              <>
                <p className="font-semibold text-emerald-300">You are eligible!</p>
                <p className="mt-1 text-slate-400">Amount: {eligibility.amount} stroops</p>
                {eligibility.alreadyClaimed && (
                  <p className="mt-2 text-amber-300">Already claimed (recorded off-chain).</p>
                )}
              </>
            ) : (
              <p className="text-red-300">{eligibility.reason ?? "Not eligible for this drop."}</p>
            )}
          </div>
        )}

        {eligibility?.eligible && claimState !== "confirmed" && !eligibility.alreadyClaimed && (
          <button
            type="button"
            className="btn-primary w-full"
            disabled={!publicKey || claimState === "submitting" || claimState === "pending"}
            onClick={handleClaim}
          >
            {claimState === "submitting"
              ? "Submitting…"
              : claimState === "pending"
                ? "Pending on-chain…"
                : "Claim now"}
          </button>
        )}

        {claimState === "confirmed" && txHash && (
          <div className="rounded-xl border border-emerald-800 bg-emerald-950/40 p-4 text-sm text-emerald-200">
            <p className="font-semibold">Claim confirmed!</p>
            <p className="mt-1 break-all font-mono text-xs">{txHash}</p>
          </div>
        )}

        {errorMsg && claimState === "failed" && (
          <p className="text-center text-sm text-red-300">{errorMsg}</p>
        )}
      </div>

      {claimState === "confirmed" && publicKey && dropId && (
        <FeedbackWidget dropId={dropId} wallet={publicKey} />
      )}
    </div>
  );
}
