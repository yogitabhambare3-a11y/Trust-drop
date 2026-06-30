import { BrowserRouter, Route, Routes } from "react-router-dom";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Layout } from "./components/Layout";
import { ToastProvider } from "./components/Toast";
import { WalletProvider } from "./context/WalletContext";
import { HomePage } from "./pages/HomePage";
import { ClaimerPage, CreatorPanel } from "./pages/Pages";

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <WalletProvider>
          <BrowserRouter>
            <Routes>
              <Route element={<Layout />}>
                <Route index element={<HomePage />} />
                <Route path="creator" element={<CreatorPanel />} />
                <Route path="claim" element={<ClaimerPage />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </WalletProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
