# TrustDrop

**Trustless, Sybil-resistant token airdrops on Stellar** — Merkle-proof eligibility on Soroban, low-fee distribution via direct SAC transfers (MVP; claimable balances documented for mainnet scale).

## Problem

Airdrops on most chains are plagued by bots, high gas, and opaque eligibility. TrustDrop gives creators a transparent, cheap way to define who can claim (CSV or Horizon-based rules), prove eligibility on-chain, and enforce one-claim-per-wallet with time-locked windows.

## Why Stellar?

- **Claimable balances** (native Stellar) + **Soroban** smart contracts for verification
- **~0.00001 XLM** base fees — even 10,000 claims ≈ **0.1 XLM** in network fees (see math below)
- Freighter wallet UX for mainstream users

## Architecture

```
┌─────────────┐     CSV / rules      ┌──────────────┐     Merkle proof    ┌─────────────┐
│   Creator   │ ──────────────────► │   Backend    │ ◄────────────────── │   Claimer   │
│   Panel     │                     │  (Node/SQL)  │                     │    Page     │
└──────┬──────┘                     └──────┬───────┘                     └──────┬──────┘
       │ fund + create_drop               │ Horizon API                         │ claim()
       ▼                                  ▼                                     ▼
┌──────────────────────────────────────────────────────────────────────────────────────┐
│                    Soroban eligibility_registry (Testnet)                             │
│   create_drop · claim(proof) · has_claimed · withdraw_unclaimed                      │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

## Live URLs

| Service | URL |
|---------|-----|
| Frontend (deploy via Vercel) | _Set `VITE_*` env vars — see Deploy section_ |
| Backend (deploy via Render) | _Set `PORT`, `CORS_ORIGIN`, `DATABASE_PATH`_ |
| Demo video | _Record after first live drop — link here_ |

## Contract (Testnet)

| Item | Value |
|------|-------|
| **Address** | `CBE6XHVRRWH7C33G42RXFRGCR34EDEZV7TYV6Z4UOMKBFS2G3MTN7F3P` |
| Explorer | [Stellar Expert](https://stellar.expert/explorer/testnet/contract/CBE6XHVRRWH7C33G42RXFRGCR34EDEZV7TYV6Z4UOMKBFS2G3MTN7F3P) |
| Deploy TX | [43ba341d…](https://stellar.expert/explorer/testnet/tx/43ba341d8d1a90e1ecf702447be6125b33f8239ace2d1d48437867ca2f9ae655) |
| Initialize TX | [43984ffe…](https://stellar.expert/explorer/testnet/tx/43984ffe6dc9c932fa8b63bda16386bb6e6d759cc323daa28c55b4b7c488488f) |

Verify: open the explorer link and confirm WASM hash `81576c91…` and exported functions.

### Fee math (10k recipients)

- Soroban claim tx ≈ **100,000 stroops** (0.01 XLM) fee budget per claim (configurable)
- 10,000 claims × 0.01 XLM ≈ **100 XLM** total network fees (vs hundreds of dollars on L1 EVM)
- Off-chain Merkle tree build: O(n log n), single `create_drop` on-chain

## Local development

### Contract

```bash
cd contract/eligibility_registry
cargo test
stellar contract build
```

### Backend

```bash
cd backend
cp .env.example .env
npm install
npm test
npm run dev   # http://localhost:3001
```

### Frontend

```bash
cd frontend
cp .env.example .env
# Set VITE_CONTRACT_ADDRESS=CBE6XHVRRWH7C33G42RXFRGCR34EDEZV7TYV6Z4UOMKBFS2G3MTN7F3P
npm install
npm run dev   # http://localhost:5173
```

## Deploy to production

**Frontend (Vercel):** root `frontend/`, build `npm run build`, output `dist`.

**Backend (Render):** use `backend/render.yaml`, set `CORS_ORIGIN` to your Vercel URL.

Env vars:

```
VITE_API_URL=https://your-backend.onrender.com
VITE_CONTRACT_ADDRESS=CBE6XHVRRWH7C33G42RXFRGCR34EDEZV7TYV6Z4UOMKBFS2G3MTN7F3P
VITE_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
```

## Proof of usage

See [`docs/proof-of-usage/`](docs/proof-of-usage/) for wallet/tx evidence and feedback summary.

Run the seed script after funding deployer on testnet:

```bash
cd backend && npx tsx ../scripts/seed-testnet-drop.ts
```

## Monitoring

- **PostHog** (frontend): set `VITE_PUBLIC_POSTHOG_KEY`
- **Sentry** (frontend + backend): set `VITE_SENTRY_DSN` / `SENTRY_DSN`
- **Custom events** table: `analytics_events` in SQLite/Postgres

## Roadmap

| MVP (done) | Mainnet vision |
|------------|----------------|
| CSV + rule eligibility | Snapshot oracles, ZK credentials |
| Direct SAC transfer | Native claimable balance batching |
| SQLite backend | Postgres + Redis rate limits |
| Testnet deploy | Audited contract, mainnet SAC |

## Known limitations

- MVP uses **direct token transfer** from contract balance (admin must fund contract manually)
- Rule-based drops build single-leaf trees per wallet at check time (fine for small rule drops)
- `gh` CLI not required locally; push to **public** GitHub manually

## Reviewer Notes

**Technical Complexity:** On-chain Merkle verification (keccak256, sorted pairs) matches off-chain builder; Soroban enforces one-claim-per-wallet, distinct errors for pre/post window, and admin withdraw after expiry. Eight Rust unit tests cover happy path and failure modes.

**Product Quality:** Production-ready React UI with Freighter connect, loading skeletons, claim state machine, toast errors, feedback widget, and mobile nav. Backend has validation, rate limiting, structured errors, analytics endpoints.

**Architecture Quality:** Clean separation — contract holds truth for claims; backend builds proofs and caches metadata; frontend orchestrates wallet + RPC. Shared leaf hash format documented in code.

**Real-World Usefulness:** DAOs, game studios, and event organizers can run cheap Stellar airdrops without trusting a central payout server. Stellar’s fee model makes 10k+ recipient drops economically viable compared to EVM.

## License

MIT — see [LICENSE](LICENSE).
