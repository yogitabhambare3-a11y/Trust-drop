const HORIZON = process.env.HORIZON_URL ?? "https://horizon-testnet.stellar.org";

export interface RuleConfig {
  minTxCount?: number;
  minAccountAgeDays?: number;
  defaultAmount?: string;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (res.status === 404) throw new Error("ACCOUNT_NOT_FOUND");
  if (!res.ok) throw new Error(`Horizon error: ${res.status}`);
  return res.json() as Promise<T>;
}

export async function evaluateRules(wallet: string, rules: RuleConfig) {
  try {
    const account = await fetchJson<{ created_at: string }>(`${HORIZON}/accounts/${wallet}`);
    const amount = rules.defaultAmount ?? "100";

    if (rules.minAccountAgeDays !== undefined) {
      const ageDays = (Date.now() - new Date(account.created_at).getTime()) / 86_400_000;
      if (ageDays < rules.minAccountAgeDays) {
        return { eligible: false, reason: `Account age ${Math.floor(ageDays)}d below minimum ${rules.minAccountAgeDays}d` };
      }
    }

    if (rules.minTxCount !== undefined) {
      const page = await fetchJson<{ _embedded: { records: unknown[] } }>(
        `${HORIZON}/accounts/${wallet}/transactions?limit=200&order=desc`
      );
      const count = page._embedded.records.length;
      if (count < rules.minTxCount) {
        return { eligible: false, reason: `Transaction count ${count} below minimum ${rules.minTxCount}` };
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
