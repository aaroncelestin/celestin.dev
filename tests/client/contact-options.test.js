// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { CONTACT_LIMITS, SERVICE_OPTIONS } from "../../src/contact-options.js";

describe("contact options", () => {
  it("exposes unique services and the server-agreed field limits", () => {
    expect(new Set(SERVICE_OPTIONS).size).toBe(SERVICE_OPTIONS.length);
    expect(SERVICE_OPTIONS).toContain("Cloud Security");
    expect(CONTACT_LIMITS).toEqual({
      name: 100,
      company: 150,
      email: 254,
      service: 100,
      message: 5000,
      website: 200,
      turnstileToken: 2048,
    });
  });
});
