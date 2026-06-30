import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import {
  isConnected,
  isAllowed,
  getAddress,
  requestAccess,
  setAllowed,
} from "@stellar/freighter-api";
import posthog from "posthog-js";

interface WalletContextValue {
  publicKey: string | null;
  connecting: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        if (await isConnected()) {
          const allowed = await isAllowed();
          if (allowed) {
            const addr = await getAddress();
            setPublicKey(addr.address);
          }
        }
      } catch {
        /* Freighter not installed */
      }
    })();
  }, []);

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      await setAllowed();
      const access = await requestAccess();
      if (access.address) {
        setPublicKey(access.address);
        posthog.capture("wallet_connected", { wallet: access.address.slice(0, 8) });
      }
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setPublicKey(null);
    posthog.capture("wallet_disconnected");
  }, []);

  return (
    <WalletContext.Provider value={{ publicKey, connecting, connect, disconnect }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}
