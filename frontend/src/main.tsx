import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import * as Sentry from "@sentry/react";
import posthog from "posthog-js";
import "./index.css";
import App from "./App";

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: 0.1,
  });
}

if (import.meta.env.VITE_PUBLIC_POSTHOG_KEY) {
  posthog.init(import.meta.env.VITE_PUBLIC_POSTHOG_KEY, {
    api_host: import.meta.env.VITE_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
    capture_pageview: true,
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
