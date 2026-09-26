import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const template = await readFile(new URL("../../template.yaml", import.meta.url), "utf8");

describe("SAM contact infrastructure", () => {
  it("defines the deployable function, URL, rate table, and outputs", () => {
    for (const expected of [
      "CelestinDevSite:",
      "Type: AWS::Serverless::Function",
      "FunctionUrlConfig:",
      "ContactRateLimitTable:",
      "Type: AWS::DynamoDB::Table",
      "TimeToLiveSpecification:",
      "AttributeName: expiresAt",
      "CelestinDevSiteArn:",
      "Value: !GetAtt CelestinDevSite.Arn",
      "CelestinDevSiteUrl:",
      "Value: !GetAtt CelestinDevSiteUrl.FunctionUrl",
    ]) {
      expect(template).toContain(expected);
    }
  });

  it("connects every deployment parameter to Lambda configuration", () => {
    for (const name of [
      "ContactSenderEmail",
      "ContactRecipientEmail",
      "SesIdentity",
      "TurnstileSecretParameterName",
      "IpHashSecretParameterName",
      "CONTACT_SENDER_EMAIL",
      "CONTACT_RECIPIENT_EMAIL",
      "RATE_LIMIT_TABLE",
      "RATE_LIMIT_MAX",
      "RATE_LIMIT_WINDOW_SECONDS",
      "TURNSTILE_SECRET_PARAMETER_NAME",
      "IP_HASH_SECRET_PARAMETER_NAME",
    ]) {
      expect(template).toContain(name);
    }
  });

  it("grants only the required provider actions with resource expressions", () => {
    expect(template).toContain("dynamodb:UpdateItem");
    expect(template).toContain("Resource: !GetAtt ContactRateLimitTable.Arn");
    expect(template).toContain("ses:SendEmail");
    expect(template).toContain("identity/${SesIdentity}");
    expect(template).toContain("ssm:GetParameter");
    expect(template).toContain("parameter${TurnstileSecretParameterName}");
    expect(template).toContain("parameter${IpHashSecretParameterName}");
  });

  it("does not embed or default either secret", () => {
    expect(template).not.toMatch(/TurnstileSecretParameterName:\s*[\s\S]*?Default:/u);
    expect(template).not.toMatch(/IpHashSecretParameterName:\s*[\s\S]*?Default:/u);
    expect(template).not.toMatch(/TURNSTILE_SECRET\s*:/u);
    expect(template).not.toMatch(/IP_HASH_SECRET\s*:/u);
  });
});
