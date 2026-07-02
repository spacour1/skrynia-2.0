import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import * as Sentry from "@sentry/node";
import path from "node:path";
import { env } from "./config/env.js";
import { apiRateLimit, metricsAuth, publicReadRateLimit, writeRateLimit } from "./common/middleware/security.js";
import { csrfProtection } from "./common/middleware/csrf.js";
import { requestContext } from "./common/middleware/request-context.js";
import { localeContext } from "./i18n/t.js";
import { errorHandler } from "./common/errors.js";
import { metricsText } from "./common/metrics.js";
import authRoutes from "./modules/auth/auth.routes.js";
import userRoutes from "./modules/users/users.routes.js";
import userBlockRoutes from "./modules/users/blocks.routes.js";
import marketplaceRoutes from "./modules/marketplace/marketplace.routes.js";
import orderRoutes from "./modules/orders/orders.routes.js";
import paymentRoutes from "./modules/payments/payments.routes.js";
import testPaymentRoutes from "./modules/payments/test-payments.routes.js";
import chatRoutes from "./modules/chat/chat.routes.js";
import disputeRoutes from "./modules/disputes/disputes.routes.js";
import reportRoutes from "./modules/reports/reports.routes.js";
import adminRoutes from "./modules/admin/admin.routes.js";
import storageRoutes from "./modules/storage/storage.routes.js";
import supportRoutes from "./modules/support/support.routes.js";
import notificationRoutes from "./modules/notifications/notifications.routes.js";
import telegramWebhookRoutes from "./modules/notifications/telegram-webhook.routes.js";
import currencyRoutes from "./modules/currencies/currencies.routes.js";

export function createApp() {
  const app = express();
  // TRUST_PROXY=1 is required behind Railway/Fly/Cloudflare so that req.ip resolves
  // to the real client IP from X-Forwarded-For instead of the proxy's address.
  // Without it, all traffic behind a reverse proxy shares one rate-limit bucket.
  if (env.TRUST_PROXY > 0) {
    app.set("trust proxy", env.TRUST_PROXY);
  }
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" }
    })
  );
  app.use(cors({ origin: env.FRONTEND_URL, credentials: true }));
  app.use(cookieParser());
  app.use(express.json({ limit: "1mb" }));
  app.use(requestContext);
  app.use(localeContext);
  app.use(apiRateLimit);
  app.use(writeRateLimit);
  app.use(csrfProtection);
  app.use("/uploads", express.static(path.resolve(env.LOCAL_UPLOAD_DIR)));

  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.get("/metrics", metricsAuth, async (_req, res) => {
    res.setHeader("content-type", "text/plain; version=0.0.4");
    res.send(await metricsText());
  });
  app.use("/auth", authRoutes);
  app.use("/users", userRoutes);
  app.use("/users", userBlockRoutes);
  app.use("/marketplace", publicReadRateLimit, marketplaceRoutes);
  app.use("/orders", orderRoutes);
  app.use("/payments", paymentRoutes);
  app.use("/payments", testPaymentRoutes);
  app.use("/chat", chatRoutes);
  app.use("/disputes", disputeRoutes);
  app.use("/reports", reportRoutes);
  app.use("/admin", adminRoutes);
  app.use("/storage", storageRoutes);
  app.use("/support", supportRoutes);
  app.use("/notifications", notificationRoutes);
  app.use("/telegram", telegramWebhookRoutes);
  app.use("/currencies", currencyRoutes);

  // Must be before custom errorHandler — captures unhandled errors thrown inside routes
  // and attaches request context (URL, method, user) to Sentry events automatically.
  Sentry.setupExpressErrorHandler(app);
  app.use(errorHandler);
  return app;
}
