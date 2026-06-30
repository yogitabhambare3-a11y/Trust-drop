/**
 * Seeds a testnet drop via the backend API and documents claim steps.
 * Usage: npx tsx scripts/seed-testnet-drop.ts
 */
import fs from "node:fs";
import path from "node:path";

const API = process.env.API_URL ?? "http://localhost:3001";
const CONTRACT = process.env.CONTRACT_ADDRESS ?? "CBE6XHVRRWH7C33G42RXFRGCR34EDEZV7TYV6Z4UOMKBFS2G3MTN7F3P";

async function main() {
  const csvPath = path.join(process.cwd(), "docs/sample-recipients.csv");
  const csv = fs.readFileSync(csvPath, "utf8");

  const fd = new FormData();
  fd.append("name", "TrustDrop Testnet Seed");
  fd.append("token", "native");
  fd.append("claimStart", String(Math.floor(Date.now() / 1000) - 3600));
  fd.append("claimEnd", String(Math.floor(Date.now() / 1000) + 86400 * 7));
  fd.append("adminWallet", "GDGVWECPXZIY4YVTO62CXJZNNYVQD6ZEZAA7Q3SPITIIDMHIPH65T6CL");
  fd.append("contractAddress", CONTRACT);
  fd.append("contractDropId", "1");
  fd.append("eligibilityMode", "csv");
  fd.append("csv", new Blob([csv], { type: "text/csv" }), "recipients.csv");

  const res = await fetch(`${API}/drops`, { method: "POST", body: fd });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));

  console.log("Drop created:", data);
  console.log(`Claim URL: http://localhost:5173/claim?drop=${data.dropId}`);
  console.log("Next: create_drop on-chain with merkle root", data.merkleRoot);
}

main().catch(console.error);
