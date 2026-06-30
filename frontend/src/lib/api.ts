// When VITE_API_URL is not set, use /api (Vercel API routes on the same domain)
const API_URL = import.meta.env.VITE_API_URL ?? "/api";

export interface DropStats {
  totalRecipients: number;
  claimedCount: number;
  claimRate: number;
}

export interface Drop {
  id: string;
  name: string;
  merkle_root: string;
  token: string;
  total_amount: string;
  claim_start: number;
  claim_end: number;
  admin_wallet: string;
  contract_drop_id?: number;
  contract_address?: string;
  eligibility_mode: string;
  stats: DropStats;
}

export interface EligibilityResponse {
  eligible: boolean;
  amount?: string;
  proof?: string[];
  reason?: string;
  alreadyClaimed?: boolean;
  contractDropId?: number;
  contractAddress?: string;
  claimStart?: number;
  claimEnd?: number;
  token?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export async function createDrop(formData: FormData) {
  return request<{ dropId: string; merkleRoot: string; totalAmount: string; recipientCount: number }>(
    "/drops",
    { method: "POST", body: formData }
  );
}

export async function getDrop(id: string) {
  return request<Drop>(`/drops/${id}`);
}

export async function getRecipients(id: string) {
  return request<{ recipients: Array<{ wallet: string; amount: string; claimed: number; claim_tx_hash?: string }> }>(
    `/drops/${id}/recipients`
  );
}

export async function checkEligibility(dropId: string, wallet: string) {
  return request<EligibilityResponse>(`/drops/${dropId}/eligibility/${wallet}`);
}

export async function recordClaim(dropId: string, wallet: string, txHash: string) {
  return request<{ ok: boolean }>(`/drops/${dropId}/claims`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet, txHash }),
  });
}

export async function submitFeedback(payload: {
  dropId: string;
  wallet: string;
  rating: number;
  comment?: string;
}) {
  return request<{ ok: boolean }>("/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function getAnalytics(dropId: string) {
  return request<unknown>(`/analytics/${dropId}`);
}
