import "dotenv/config";
import * as Sentry from "@sentry/node";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "./db.js";
import { analyticsRouter, dropsRouter, feedbackRouter } from "./routes.js";
import { AppError } from "./validation.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "../data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? "development",
    tracesSampleRate: 0.1,
  });
}

const app = express();
const PORT = Number(process.env.PORT ?? 3001);

app.use(cors({ origin: process.env.CORS_ORIGIN ?? "*" }));
app.use(express.json({ limit: "2mb" }));

const limiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "trustdrop-backend" });
});

app.use("/drops", dropsRouter);
app.use("/feedback", feedbackRouter);
app.use("/analytics", analyticsRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "Not found", code: "NOT_FOUND" });
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (process.env.SENTRY_DSN && err instanceof Error) {
    Sentry.captureException(err);
  }
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ error: err.message, code: err.code });
  }
  if (err && typeof err === "object" && "name" in err && err.name === "ZodError") {
    return res.status(400).json({ error: "Validation failed", code: "VALIDATION_ERROR" });
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error", code: "INTERNAL_ERROR" });
});

app.listen(PORT, () => {
  console.log(`TrustDrop backend listening on :${PORT}`);
});
