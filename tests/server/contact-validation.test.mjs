import { describe, expect, it } from "vitest";
import {
  CONTACT_LIMITS,
  normalizeText,
  validateContactPayload,
} from "../../server/contact-validation.mjs";

const validFixture = {
  name: "Jane Smith",
  company: "Example Co",
  email: "jane@example.com",
  service: "Cloud Security",
  message: "We need help reviewing AWS.",
  website: "",
  turnstileToken: "token",
};

describe("validateContactPayload", () => {
  it.each([null, [], "text", 42])("rejects a non-object payload: %j", (body) => {
    expect(validateContactPayload(body)).toEqual({ ok: false, fields: ["request"] });
  });

  it("normalizes safe Unicode, line endings, and control characters", () => {
    const result = validateContactPayload({
      ...validFixture,
      name: "  Jane\u00a0Smith  ",
      company: " Example\r\nCo ",
      email: " jane@example.com ",
      message: "Line one\r\nLine two\u0000",
    });

    expect(result).toEqual({
      ok: true,
      data: {
        ...validFixture,
        name: "Jane Smith",
        company: "Example\nCo",
        email: "jane@example.com",
        message: "Line one\nLine two",
      },
    });
  });

  it("rejects unknown properties without reflecting them", () => {
    expect(validateContactPayload({ ...validFixture, extra: "no" })).toEqual({
      ok: false,
      fields: ["request"],
    });
  });

  it.each([
    ["name", ""],
    ["email", "not-an-email"],
    ["email", "a@b.com\r\nBcc:x@y.com"],
    ["service", "Invented Service"],
    ["message", ""],
    ["turnstileToken", ""],
    ["company", 5],
    ["message", { text: "hello" }],
  ])("rejects an invalid %s field", (field, value) => {
    expect(validateContactPayload({ ...validFixture, [field]: value })).toEqual({
      ok: false,
      fields: [field],
    });
  });

  it("accepts optional company and website when both are empty", () => {
    expect(validateContactPayload({ ...validFixture, company: "", website: "" }).ok).toBe(true);
  });

  it("returns sorted, de-duplicated invalid field names", () => {
    const result = validateContactPayload({
      ...validFixture,
      message: "",
      email: "bad",
      name: 5,
    });
    expect(result).toEqual({ ok: false, fields: ["email", "message", "name"] });
  });

  it.each([
    ["name", "n", CONTACT_LIMITS.name],
    ["company", "c", CONTACT_LIMITS.company],
    ["email", "e", CONTACT_LIMITS.email],
    ["message", "m", CONTACT_LIMITS.message],
    ["website", "w", CONTACT_LIMITS.website],
    ["turnstileToken", "t", CONTACT_LIMITS.turnstileToken],
  ])("rejects %s only after its maximum length", (field, character, maximum) => {
    const atLimit = { ...validFixture, [field]: character.repeat(maximum) };
    if (field === "email") {
      atLimit.email = `${"a".repeat(64)}@${"b".repeat(185)}.com`;
    }
    expect(validateContactPayload(atLimit).fields ?? []).not.toContain(field);

    const overLimit = { ...validFixture, [field]: character.repeat(maximum + 1) };
    expect(validateContactPayload(overLimit).fields).toContain(field);
  });

  it("rejects a service value over its limit", () => {
    expect(validateContactPayload({
      ...validFixture,
      service: "s".repeat(CONTACT_LIMITS.service + 1),
    })).toEqual({ ok: false, fields: ["service"] });
  });

  it("rejects objects with a non-standard prototype", () => {
    const body = Object.assign(Object.create({ inherited: true }), validFixture);
    expect(validateContactPayload(body)).toEqual({ ok: false, fields: ["request"] });
  });
});

describe("normalizeText", () => {
  it("collapses all single-line whitespace and preserves safe message newlines", () => {
    expect(normalizeText("  Jane\t\u00a0 Smith  ", { singleLine: true })).toBe("Jane Smith");
    expect(normalizeText(" first \r\n second \n")).toBe("first\n second");
  });
});
