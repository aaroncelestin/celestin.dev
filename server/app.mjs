import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import serverlessExpress from "@codegenie/serverless-express";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { SSMClient } from "@aws-sdk/client-ssm";
import { SESv2Client } from "@aws-sdk/client-sesv2";
import { createContactHandler } from "./contact-handler.mjs";
import {
  createMailer,
  createRateLimiter,
  createSecretLoader,
  hashIp,
  resolveClientIp,
  verifyTurnstile,
} from "./contact-infrastructure.mjs";
import { validateContactPayload } from "./contact-validation.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.resolve(__dirname, "../dist");

const dynamoClient = new DynamoDBClient({});
const ssmClient = new SSMClient({});
const sesClient = new SESv2Client({});

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const productionContactHandler = createContactHandler({
  validate: validateContactPayload,
  loadSecrets: createSecretLoader({
    ssmClient,
    turnstileParameterName: process.env.TURNSTILE_SECRET_PARAMETER_NAME,
    ipHashParameterName: process.env.IP_HASH_SECRET_PARAMETER_NAME,
  }),
  rateLimiter: createRateLimiter({
    dynamoClient,
    tableName: process.env.RATE_LIMIT_TABLE,
    maxAttempts: positiveInteger(process.env.RATE_LIMIT_MAX, 5),
    windowSeconds: positiveInteger(process.env.RATE_LIMIT_WINDOW_SECONDS, 900),
  }),
  verifyCaptcha: verifyTurnstile,
  mailer: createMailer({
    sesClient,
    sender: process.env.CONTACT_SENDER_EMAIL,
    recipient: process.env.CONTACT_RECIPIENT_EMAIL,
  }),
  hashIp,
  resolveIp: resolveClientIp,
  logger: console,
});

export function getSourceIp(req) {
  return req.apiGateway?.event?.requestContext?.http?.sourceIp
    || req.socket?.remoteAddress
    || "unknown";
}

function getRequestId(req) {
  return req.get("x-amzn-trace-id") || req.get("x-request-id") || randomUUID();
}

export function createApp({ contactHandler = productionContactHandler } = {}) {
  const app = express();
  app.disable("x-powered-by");

  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    if (req.path.startsWith("/api/")) {
      res.setHeader("Cache-Control", "no-store");
    }
    next();
  });

  app.use(express.json({ limit: "100kb" }));

  app.get("/api/health", (_req, res) => {
    res.status(200).json({
      status: "healthy",
      service: "celestin-industries-web",
    });
  });

  app.post("/api/contact", async (req, res) => {
    if (!req.is("application/json")) {
      return res.status(415).json({
        ok: false,
        error: "Content-Type must be application/json.",
      });
    }

    const result = await contactHandler({
      body: req.body,
      ip: getSourceIp(req),
      viewerAddress: req.get("cloudfront-viewer-address"),
      originProof: req.get("x-celestin-origin-verify"),
      requestId: getRequestId(req),
    });
    for (const [name, value] of Object.entries(result.headers)) {
      res.setHeader(name, value);
    }
    return res.status(result.status).json(result.body);
  });

  app.use("/api", (_req, res) => {
    res.status(404).json({ ok: false, error: "API endpoint not found." });
  });

  app.use(express.static(distPath, { maxAge: "1d", etag: true }));

  app.use((_req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });

  app.use((error, _req, res, next) => {
    if (error?.type === "entity.parse.failed") {
      return res.status(400).json({ ok: false, error: "Invalid JSON request." });
    }
    return next(error);
  });

  return app;
}

export const app = createApp();
export const handler = serverlessExpress({ app });
