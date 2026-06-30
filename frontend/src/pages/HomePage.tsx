import { Link } from "react-router-dom";

export function HomePage() {
  return (
    <section className="py-10 text-center sm:py-16">
      <p className="text-sm font-medium uppercase tracking-widest text-brand-500">Stellar Testnet</p>
      <h1 className="mt-3 text-4xl font-bold tracking-tight text-white sm:text-5xl">
        Trustless airdrops, <span className="text-brand-500">Sybil-resistant</span>
      </h1>
      <p className="mx-auto mt-4 max-w-2xl text-slate-400">
        TrustDrop lets creators run bot-resistant token drops using Merkle proofs on Soroban and
        Stellar&apos;s low-fee claimable balances.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link to="/creator" className="btn-primary">
          Create a drop
        </Link>
        <Link to="/claim" className="btn-secondary">
          Claim tokens
        </Link>
      </div>
    </section>
  );
}
