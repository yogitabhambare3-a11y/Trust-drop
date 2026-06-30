const HORIZON = process.env.HORIZON_URL ?? "https://horizon-testnet.stellar.org";

export interface RuleConfig {
  minTxCount?: number;
  minAccountAgeDays?: number;
  snapshotDate?: string;
  defaultAmount?: string;
}

export interface EligibilityResult {
  eligible: boolean;
  amount?: string;
  reason?: string;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (res.status === 404) {
    throw new Error("ACCOUNT_NOT_FOUND");
  }
  if (!res.ok) {
    throw new Error(`Horizon error: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function evaluateRules(
  wallet: string,
  rules: RuleConfig
): Promise<EligibilityResult> {
  try {
    const account = await fetchJson<{ created_at: string; sequence: string }>(
      `${HORIZON}/accounts/${wallet}`
    );

    const amount = rules.defaultAmount ?? "100";

    if (rules.minAccountAgeDays !== undefined) {
      const created = new Date(account.created_at).getTime();
      const ageDays = (Date.now() - created) / (1000 * 60 * 60 * 24);
      if (ageDays < rules.minAccountAgeDays) {
        return {
          eligible: false,
          reason: `Account age ${Math.floor(ageDays)}d below minimum ${rules.minAccountAgeDays}d`,
        };
      }
    }

    if (rules.minTxCount !== undefined) {
      const txPage = await fetchJson<{ _embedded: { records: unknown[] } }>(
        `${HORIZON}/accounts/${wallet}/transactions?limit=200&order=desc`
      );
      const txCount = txPage._embedded.records.length;
      if (txCount < rules.minTxCount) {
        return {
          eligible: false,
          reason: `Transaction count ${txCount} below minimum ${rules.minTxCount}`,
        };
      }
    }

    return { eligible: true, amount };
  } catch (err) {
    if (err instanceof Error && err.message === "ACCOUNT_NOT_FOUND") {
      return { eligible: false, reason: "Account not found on Stellar testnet" };
    }
    throw err;
  }
}
