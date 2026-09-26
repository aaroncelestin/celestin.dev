import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContactHandler } from "../../server/contact-handler.mjs";

const normalized = {
  name: "Jane Smith",
  company: "Example Co",
  email: "jane@example.com",
  service: "Cloud Security",
  message: "Please review our AWS environment.",
  website: "",
  turnstileToken: "captcha-token",
};

function dependencies(overrides = {}) {
  return {
    validate: vi.fn(() => ({ ok: true, data: normalized })),
    loadSecrets: vi.fn(async () => ({
      turnstileSecret: "turnstile-secret",
      ipHashSecret: "ip-hash-secret",
    })),
    rateLimiter: vi.fn(async () => ({ allowed: true, retryAfter: 900 })),
    verifyCaptcha: vi.fn(async () => true),
    mailer: vi.fn(async () => undefined),
    hashIp: vi.fn(() => "opaque-ip-hash"),
    resolveIp: vi.fn(() => "198.51.100.10"),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...overrides,
  };
}

const request = {
  body: { submitted: "payload" },
  ip: "203.0.113.8",
  viewerAddress: "198.51.100.10:46532",
  originProof: "ip-hash-secret",
  requestId: "request-123",
};

describe("createContactHandler", () => {
  let deps;

  beforeEach(() => {
    deps = dependencies();
  });

  it("rejects invalid input before loading secrets or calling providers", async () => {
    deps.validate.mockReturnValue({ ok: false, fields: ["email"] });
    const handle = createContactHandler(deps);

    await expect(handle(request)).resolves.toEqual({
      status: 400,
      body: { ok: false, error: "Please check the highlighted fields." },
      headers: {},
    });
    expect(deps.loadSecrets).not.toHaveBeenCalled();
    expect(deps.rateLimiter).not.toHaveBeenCalled();
    expect(deps.verifyCaptcha).not.toHaveBeenCalled();
    expect(deps.mailer).not.toHaveBeenCalled();
  });

  it("returns generic success for honeypot submissions without provider calls", async () => {
    deps.validate.mockReturnValue({ ok: true, data: { ...normalized, website: "bot.example" } });
    const handle = createContactHandler(deps);

    await expect(handle(request)).resolves.toEqual({
      status: 200,
      body: { ok: true },
      headers: {},
    });
    expect(deps.loadSecrets).not.toHaveBeenCalled();
    expect(deps.mailer).not.toHaveBeenCalled();
  });

  it("returns Retry-After when the atomic limiter denies the request", async () => {
    deps.rateLimiter.mockResolvedValue({ allowed: false, retryAfter: 417 });
    const handle = createContactHandler(deps);

    await expect(handle(request)).resolves.toEqual({
      status: 429,
      body: { ok: false, error: "Too many requests. Please try again later." },
      headers: { "Retry-After": "417" },
    });
    expect(deps.resolveIp).toHaveBeenCalledWith({
      sourceIp: "203.0.113.8",
      viewerAddress: "198.51.100.10:46532",
      originProof: "ip-hash-secret",
    }, "ip-hash-secret");
    expect(deps.hashIp).toHaveBeenCalledWith("198.51.100.10", "ip-hash-secret");
    expect(deps.rateLimiter).toHaveBeenCalledWith("opaque-ip-hash");
    expect(deps.verifyCaptcha).not.toHaveBeenCalled();
    expect(deps.mailer).not.toHaveBeenCalled();
  });

  it.each([
    ["rejected", "reject"],
    ["unavailable", "error"],
  ])("returns a safe validation error when CAPTCHA is %s", async (_name, mode) => {
    if (mode === "error") {
      deps.verifyCaptcha.mockRejectedValue(new Error("captcha offline"));
    } else {
      deps.verifyCaptcha.mockResolvedValue(false);
    }
    const handle = createContactHandler(deps);

    await expect(handle(request)).resolves.toEqual({
      status: 400,
      body: { ok: false, error: "Please verify that you are human and try again." },
      headers: {},
    });
    expect(deps.mailer).not.toHaveBeenCalled();
  });

  it("returns a generic server error when SES delivery fails", async () => {
    deps.mailer.mockRejectedValue(new Error("SES unavailable"));
    const handle = createContactHandler(deps);

    await expect(handle(request)).resolves.toEqual({
      status: 500,
      body: { ok: false, error: "We could not send your request. Please try again later." },
      headers: {},
    });
  });

  it("sends one normalized inquiry after all controls pass", async () => {
    const handle = createContactHandler(deps);

    await expect(handle(request)).resolves.toEqual({
      status: 200,
      body: { ok: true },
      headers: {},
    });
    expect(deps.verifyCaptcha).toHaveBeenCalledWith({
      token: "captcha-token",
      ip: "198.51.100.10",
      secret: "turnstile-secret",
    });
    expect(deps.mailer).toHaveBeenCalledTimes(1);
    expect(deps.mailer).toHaveBeenCalledWith(normalized);
  });

  it("logs only correlation and outcome metadata", async () => {
    const handle = createContactHandler(deps);
    await handle(request);

    const logs = JSON.stringify([
      ...deps.logger.info.mock.calls,
      ...deps.logger.warn.mock.calls,
      ...deps.logger.error.mock.calls,
    ]);
    expect(logs).toContain("request-123");
    expect(logs).toContain("sent");
    for (const sensitive of [
      "203.0.113.8",
      "jane@example.com",
      "Please review our AWS environment.",
      "captcha-token",
      "turnstile-secret",
      "ip-hash-secret",
    ]) {
      expect(logs).not.toContain(sensitive);
    }
  });
});
