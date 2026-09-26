import { describe, expect, it, vi } from "vitest";
import {
  createMailer,
  createRateLimiter,
  createSecretLoader,
  hashIp,
  resolveClientIp,
  verifyTurnstile,
} from "../../server/contact-infrastructure.mjs";

const contact = {
  name: "Jane Smith",
  company: "Example Co",
  email: "jane@example.com",
  service: "Cloud Security",
  message: "Please review our AWS environment.",
};

describe("createSecretLoader", () => {
  it("decrypts both parameters once and caches them for warm invocations", async () => {
    const ssmClient = {
      send: vi.fn(async (command) => ({
        Parameter: {
          Value: command.input.Name.endsWith("turnstile") ? "captcha-secret" : "hash-secret",
        },
      })),
    };
    const loadSecrets = createSecretLoader({
      ssmClient,
      turnstileParameterName: "/site/turnstile",
      ipHashParameterName: "/site/ip-hash",
    });

    await expect(loadSecrets()).resolves.toEqual({
      turnstileSecret: "captcha-secret",
      ipHashSecret: "hash-secret",
    });
    await loadSecrets();

    expect(ssmClient.send).toHaveBeenCalledTimes(2);
    expect(ssmClient.send.mock.calls.map(([command]) => command.input)).toEqual([
      { Name: "/site/turnstile", WithDecryption: true },
      { Name: "/site/ip-hash", WithDecryption: true },
    ]);
  });

  it("rejects missing secret values", async () => {
    const loadSecrets = createSecretLoader({
      ssmClient: { send: vi.fn(async () => ({ Parameter: {} })) },
      turnstileParameterName: "/site/turnstile",
      ipHashParameterName: "/site/ip-hash",
    });
    await expect(loadSecrets()).rejects.toThrow("Contact form secret configuration is unavailable");
  });
});

describe("hashIp", () => {
  it("returns a deterministic opaque HMAC digest", () => {
    const result = hashIp("203.0.113.8", "secret");
    expect(result).toMatch(/^[a-f0-9]{64}$/);
    expect(result).not.toContain("203.0.113.8");
    expect(result).toBe(hashIp("203.0.113.8", "secret"));
    expect(result).not.toBe(hashIp("203.0.113.9", "secret"));
  });
});

describe("resolveClientIp", () => {
  it("uses CloudFront's generated viewer address only with valid origin proof", () => {
    expect(resolveClientIp({
      sourceIp: "54.240.1.10",
      viewerAddress: "198.51.100.10:46532",
      originProof: "hash-secret",
    }, "hash-secret")).toBe("198.51.100.10");

    expect(resolveClientIp({
      sourceIp: "54.240.1.10",
      viewerAddress: "[2001:db8::10]:46532",
      originProof: "hash-secret",
    }, "hash-secret")).toBe("2001:db8::10");
  });

  it("ignores spoofed or malformed forwarding metadata", () => {
    expect(resolveClientIp({
      sourceIp: "203.0.113.9",
      viewerAddress: "198.51.100.10:46532",
      originProof: "wrong-secret",
    }, "hash-secret")).toBe("203.0.113.9");

    expect(resolveClientIp({
      sourceIp: "203.0.113.9",
      viewerAddress: "not-an-ip:46532",
      originProof: "hash-secret",
    }, "hash-secret")).toBe("203.0.113.9");
  });
});

describe("createRateLimiter", () => {
  it("uses an atomic conditional update in the current fixed window", async () => {
    const dynamoClient = { send: vi.fn(async () => ({})) };
    const check = createRateLimiter({
      dynamoClient,
      tableName: "rate-table",
      maxAttempts: 5,
      windowSeconds: 900,
      now: () => 1_800_000,
    });

    await expect(check("abc123")).resolves.toEqual({ allowed: true, retryAfter: 900 });
    expect(dynamoClient.send).toHaveBeenCalledTimes(1);
    expect(dynamoClient.send.mock.calls[0][0].input).toMatchObject({
      TableName: "rate-table",
      Key: { rateKey: { S: "abc123:1800" } },
      UpdateExpression: "ADD attemptCount :one SET expiresAt = if_not_exists(expiresAt, :expiresAt)",
      ConditionExpression: "attribute_not_exists(attemptCount) OR attemptCount < :maxAttempts",
      ExpressionAttributeValues: {
        ":one": { N: "1" },
        ":maxAttempts": { N: "5" },
        ":expiresAt": { N: "2700" },
      },
    });
  });

  it("maps only conditional failures to a denied decision", async () => {
    const conditional = new Error("limit reached");
    conditional.name = "ConditionalCheckFailedException";
    const denied = createRateLimiter({
      dynamoClient: { send: vi.fn(async () => { throw conditional; }) },
      tableName: "rate-table",
      maxAttempts: 5,
      windowSeconds: 900,
      now: () => 1_800_000,
    });
    await expect(denied("abc")).resolves.toEqual({ allowed: false, retryAfter: 900 });

    const outage = createRateLimiter({
      dynamoClient: { send: vi.fn(async () => { throw new Error("offline"); }) },
      tableName: "rate-table",
      maxAttempts: 5,
      windowSeconds: 900,
      now: () => 1_800_000,
    });
    await expect(outage("abc")).rejects.toThrow("offline");
  });

  it("allows exactly one of two concurrent attempts at the boundary", async () => {
    let count = 4;
    const dynamoClient = {
      send: vi.fn(async (command) => {
        const maximum = Number(command.input.ExpressionAttributeValues[":maxAttempts"].N);
        if (count >= maximum) {
          const error = new Error("limit reached");
          error.name = "ConditionalCheckFailedException";
          throw error;
        }
        count += 1;
      }),
    };
    const check = createRateLimiter({
      dynamoClient,
      tableName: "rate-table",
      maxAttempts: 5,
      windowSeconds: 900,
      now: () => 1_800_000,
    });

    const results = await Promise.all([check("abc"), check("abc")]);
    expect(results.filter(({ allowed }) => allowed)).toHaveLength(1);
  });
});

describe("verifyTurnstile", () => {
  it("posts URL-encoded verification data and accepts only explicit success", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ success: true }),
    }));

    await expect(verifyTurnstile({
      token: "response-token",
      ip: "203.0.113.8",
      secret: "captcha-secret",
      fetchImpl,
    })).resolves.toBe(true);

    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(options.method).toBe("POST");
    expect(options.headers).toEqual({ "Content-Type": "application/x-www-form-urlencoded" });
    expect(options.body).toBeInstanceOf(URLSearchParams);
    expect(Object.fromEntries(options.body)).toEqual({
      secret: "captcha-secret",
      response: "response-token",
      remoteip: "203.0.113.8",
    });
  });

  it.each([
    ["rejected token", async () => ({ ok: true, json: async () => ({ success: false }) })],
    ["HTTP failure", async () => ({ ok: false, json: async () => ({ success: true }) })],
    ["malformed response", async () => ({ ok: true, json: async () => { throw new Error("bad json"); } })],
    ["network failure", async () => { throw new Error("offline"); }],
  ])("fails closed for %s", async (_name, fetchImpl) => {
    await expect(verifyTurnstile({
      token: "token",
      ip: "203.0.113.8",
      secret: "secret",
      fetchImpl,
    })).resolves.toBe(false);
  });
});

describe("createMailer", () => {
  it("sends a plain-text inquiry with fixed headers and validated Reply-To", async () => {
    const sesClient = { send: vi.fn(async () => ({ MessageId: "message-1" })) };
    const send = createMailer({
      sesClient,
      sender: "website@celestin.dev",
      recipient: "aaron@celestin.dev",
      now: () => new Date("2026-09-20T12:34:56.000Z"),
    });

    await send(contact);

    const input = sesClient.send.mock.calls[0][0].input;
    expect(input).toMatchObject({
      FromEmailAddress: "website@celestin.dev",
      Destination: { ToAddresses: ["aaron@celestin.dev"] },
      ReplyToAddresses: ["jane@example.com"],
      Content: {
        Simple: {
          Subject: { Data: "[Celestin.dev] Contact request: Cloud Security", Charset: "UTF-8" },
        },
      },
    });
    expect(input.Content.Simple.Body).not.toHaveProperty("Html");
    expect(input.Content.Simple.Body.Text.Data).toContain("Name: Jane Smith");
    expect(input.Content.Simple.Body.Text.Data).toContain("Company: Example Co");
    expect(input.Content.Simple.Body.Text.Data).toContain("Submitted: 2026-09-20T12:34:56.000Z");
    expect(input.Content.Simple.Body.Text.Data).toContain("Please review our AWS environment.");
  });
});
