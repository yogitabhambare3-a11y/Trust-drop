import { Link, Outlet } from "react-router-dom";
import { useWallet } from "../context/WalletContext";

export function Layout() {
  const { publicKey, connecting, connect, disconnect } = useWallet();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4">
          <Link to="/" className="text-lg font-bold tracking-tight text-brand-100">
            TrustDrop
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-slate-300 sm:flex">
            <Link to="/creator" className="hover:text-white">
              Creator Panel
            </Link>
            <Link to="/claim" className="hover:text-white">
              Claim
            </Link>
          </nav>
          <div className="flex items-center gap-2">
            {publicKey ? (
              <>
                <span className="hidden max-w-[140px] truncate text-xs text-slate-400 sm:inline">
                  {publicKey}
                </span>
                <button type="button" className="btn-secondary text-xs" onClick={disconnect}>
                  Disconnect
                </button>
              </>
            ) : (
              <button type="button" className="btn-primary text-xs" onClick={connect} disabled={connecting}>
                {connecting ? "Connecting…" : "Connect Freighter"}
              </button>
            )}
          </div>
        </div>
        <nav className="flex gap-4 border-t border-slate-800 px-4 py-2 text-sm sm:hidden">
          <Link to="/creator">Creator</Link>
          <Link to="/claim">Claim</Link>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
      <footer className="border-t border-slate-800 py-6 text-center text-xs text-slate-500">
        TrustDrop · Stellar Testnet · Sybil-resistant airdrops
      </footer>
    </div>
  );
}
