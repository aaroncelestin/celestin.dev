import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { GetParameterCommand } from "@aws-sdk/client-ssm";
import { SendEmailCommand } from "@aws-sdk/client-sesv2";

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function createSecretLoader({
  ssmClient,
  turnstileParameterName,
  ipHashParameterName,
}) {
  let cachedSecrets;

  return async function loadSecrets() {
    if (cachedSecrets) {
      return cachedSecrets;
    }

    const [turnstileResult, ipHashResult] = await Promise.all([
      ssmClient.send(new GetParameterCommand({
        Name: turnstileParameterName,
        WithDecryption: true,
      })),
      ssmClient.send(new GetParameterCommand({
        Name: ipHashParameterName,
        WithDecryption: true,
      })),
    ]);

    const turnstileSecret = turnstileResult.Parameter?.Value;
    const ipHashSecret = ipHashResult.Parameter?.Value;
    if (!turnstileSecret || !ipHashSecret) {
      throw new Error("Contact form secret configuration is unavailable");
    }

    cachedSecrets = { turnstileSecret, ipHashSecret };
    return cachedSecrets;
  };
}

export function hashIp(ip, secret) {
  return createHmac("sha256", secret).update(ip).digest("hex");
}

function secretsEqual(actual, expected) {
  if (typeof actual !== "string" || typeof expected !== "string" || !actual || !expected) {
    return false;
  }
  const actualDigest = createHash("sha256").update(actual).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}

function parseViewerAddress(value) {
  if (typeof value !== "string") {
    return null;
  }
  const bracketed = value.match(/^\[([^\]]+)\](?::\d+)?$/u);
  if (bracketed && isIP(bracketed[1])) {
    return bracketed[1];
  }
  const separator = value.lastIndexOf(":");
  const candidate = separator > 0 ? value.slice(0, separator) : value;
  return isIP(candidate) ? candidate : null;
}

export function resolveClientIp({ sourceIp, viewerAddress, originProof }, expectedOriginProof) {
  if (!secretsEqual(originProof, expectedOriginProof)) {
    return sourceIp;
  }
  return parseViewerAddress(viewerAddress) || sourceIp;
}

export function createRateLimiter({
  dynamoClient,
  tableName,
  maxAttempts,
  windowSeconds,
  now = Date.now,
}) {
  return async function check(ipHash) {
    const epochSeconds = Math.floor(now() / 1000);
    const windowStart = Math.floor(epochSeconds / windowSeconds) * windowSeconds;
    const expiresAt = windowStart + windowSeconds;
    const retryAfter = Math.max(1, expiresAt - epochSeconds);

    try {
      await dynamoClient.send(new UpdateItemCommand({
        TableName: tableName,
        Key: { rateKey: { S: `${ipHash}:${windowStart}` } },
        UpdateExpression: "ADD attemptCount :one SET expiresAt = if_not_exists(expiresAt, :expiresAt)",
        ConditionExpression: "attribute_not_exists(attemptCount) OR attemptCount < :maxAttempts",
        ExpressionAttributeValues: {
          ":one": { N: "1" },
          ":maxAttempts": { N: String(maxAttempts) },
          ":expiresAt": { N: String(expiresAt) },
        },
      }));
      return { allowed: true, retryAfter };
    } catch (error) {
      if (error?.name === "ConditionalCheckFailedException") {
        return { allowed: false, retryAfter };
      }
      throw error;
    }
  };
}

export async function verifyTurnstile({ token, ip, secret, fetchImpl = fetch }) {
  try {
    const body = new URLSearchParams({
      secret,
      response: token,
      remoteip: ip,
    });
    const response = await fetchImpl(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      return false;
    }
    const result = await response.json();
    return result?.success === true;
  } catch {
    return false;
  }
}

export function createMailer({ sesClient, sender, recipient, now = () => new Date() }) {
  return async function send(contact) {
    const body = [
      "New contact request from celestin.dev",
      "",
      `Name: ${contact.name}`,
      `Company: ${contact.company || "Not provided"}`,
      `Email: ${contact.email}`,
      `Service: ${contact.service}`,
      `Submitted: ${now().toISOString()}`,
      "",
      "Message:",
      contact.message,
    ].join("\n");

    await sesClient.send(new SendEmailCommand({
      FromEmailAddress: sender,
      Destination: { ToAddresses: [recipient] },
      ReplyToAddresses: [contact.email],
      Content: {
        Simple: {
          Subject: {
            Data: `[Celestin.dev] Contact request: ${contact.service}`,
            Charset: "UTF-8",
          },
          Body: {
            Text: { Data: body, Charset: "UTF-8" },
          },
        },
      },
    }));
  };
}
