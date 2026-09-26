export const SERVICE_OPTIONS = Object.freeze([
  "Cybersecurity / Risk Assessment",
  "Managed IT Services",
  "Network / Perimeter Security",
  "Active Directory / Identity",
  "Cloud Security",
  "Endpoint Security",
  "AI Security",
  "Physical / On-Prem Security",
  "Website Design / Management",
  "Other",
]);

export const CONTACT_LIMITS = Object.freeze({
  name: 100,
  company: 150,
  email: 254,
  service: 100,
  message: 5000,
  website: 200,
  turnstileToken: 2048,
});

const ALLOWED_FIELDS = new Set(Object.keys(CONTACT_LIMITS));
const REQUIRED_FIELDS = new Set(["name", "email", "service", "message", "turnstileToken"]);
const SINGLE_LINE_FIELDS = new Set(["name", "email", "service", "website", "turnstileToken"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export function normalizeText(value, { singleLine = false } = {}) {
  const normalized = value
    .normalize("NFKC")
    .replace(/\r\n?/gu, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, "");

  return singleLine
    ? normalized.replace(/[\s\u00A0]+/gu, " ").trim()
    : normalized.split("\n").map((line) => line.trimEnd()).join("\n").trim();
}

function isPlainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

export function validateContactPayload(value) {
  if (!isPlainObject(value)) {
    return { ok: false, fields: ["request"] };
  }

  if (Object.keys(value).some((field) => !ALLOWED_FIELDS.has(field))) {
    return { ok: false, fields: ["request"] };
  }

  const fields = [];
  const data = {};

  for (const field of ALLOWED_FIELDS) {
    const rawValue = value[field] ?? "";
    if (typeof rawValue !== "string") {
      fields.push(field);
      continue;
    }

    if (field === "email" && /[\r\n]/u.test(rawValue)) {
      fields.push(field);
      continue;
    }

    const normalized = normalizeText(rawValue, {
      singleLine: SINGLE_LINE_FIELDS.has(field),
    });
    data[field] = normalized;

    if (normalized.length > CONTACT_LIMITS[field]) {
      fields.push(field);
      continue;
    }

    if (REQUIRED_FIELDS.has(field) && normalized.length === 0) {
      fields.push(field);
      continue;
    }

    if (field === "email" && !EMAIL_PATTERN.test(normalized)) {
      fields.push(field);
    }

    if (field === "service" && !SERVICE_OPTIONS.includes(normalized)) {
      fields.push(field);
    }
  }

  if (fields.length > 0) {
    return { ok: false, fields: [...new Set(fields)].sort() };
  }

  return { ok: true, data };
}
