import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp, getSourceIp } from "../../server/app.mjs";

function successfulController() {
  return vi.fn(async () => ({
    status: 200,
    body: { ok: true },
    headers: {},
  }));
}

describe("contact HTTP contract", () => {
  it("rejects non-JSON contact requests without invoking the controller", async () => {
    const contactHandler = successfulController();
    const app = createApp({ contactHandler });
    const response = await request(app)
      .post("/api/contact")
      .set("Content-Type", "text/plain")
      .send("x")
      .expect(415);

    expect(response.body).toEqual({ ok: false, error: "Content-Type must be application/json." });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(contactHandler).not.toHaveBeenCalled();
  });

  it("passes JSON, source IP, and request ID to the controller", async () => {
    const contactHandler = successfulController();
    const app = createApp({ contactHandler });
    app.request.apiGateway = {
      event: { requestContext: { http: { sourceIp: "198.51.100.10" } } },
    };

    const response = await request(app)
      .post("/api/contact")
      .set("X-Forwarded-For", "203.0.113.99")
      .set("CloudFront-Viewer-Address", "192.0.2.25:45678")
      .set("X-Celestin-Origin-Verify", "origin-proof")
      .set("X-Amzn-Trace-Id", "Root=trace-123")
      .send({ hello: "world" })
      .expect(200, { ok: true });

    expect(response.headers["cache-control"]).toBe("no-store");
    expect(contactHandler).toHaveBeenCalledWith({
      body: { hello: "world" },
      ip: "198.51.100.10",
      viewerAddress: "192.0.2.25:45678",
      originProof: "origin-proof",
      requestId: "Root=trace-123",
    });
  });

  it("returns JSON for malformed request bodies", async () => {
    const app = createApp({ contactHandler: successfulController() });
    await request(app)
      .post("/api/contact")
      .set("Content-Type", "application/json")
      .send('{"broken"')
      .expect(400, { ok: false, error: "Invalid JSON request." });
  });

  it("returns an API-only 404 without falling through to the SPA", async () => {
    const app = createApp({ contactHandler: successfulController() });
    const response = await request(app)
      .get("/api/missing")
      .expect(404, { ok: false, error: "API endpoint not found." });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("keeps the health endpoint available and uncached", async () => {
    const app = createApp({ contactHandler: successfulController() });
    const response = await request(app).get("/api/health").expect(200);
    expect(response.body).toEqual({
      status: "healthy",
      service: "celestin-industries-web",
    });
    expect(response.headers["cache-control"]).toBe("no-store");
  });
});

describe("getSourceIp", () => {
  it("prefers the signed Lambda request context over visitor-controlled headers", () => {
    const req = {
      apiGateway: { event: { requestContext: { http: { sourceIp: "198.51.100.10" } } } },
      headers: { "x-forwarded-for": "203.0.113.99" },
      socket: { remoteAddress: "127.0.0.1" },
    };
    expect(getSourceIp(req)).toBe("198.51.100.10");
  });

  it("uses the socket address only when Lambda context is absent", () => {
    expect(getSourceIp({ socket: { remoteAddress: "127.0.0.1" } })).toBe("127.0.0.1");
  });
});
