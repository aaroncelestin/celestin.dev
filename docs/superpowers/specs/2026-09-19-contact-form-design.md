# Celestin.dev Contact Form Design

## Goal

Replace the demonstration contact form with a production-ready, same-origin `POST /api/contact` workflow that validates and sanitizes submissions, limits abuse, verifies Cloudflare Turnstile, and delivers inquiries through Amazon SES. The complete application must remain deployable through AWS SAM.

## Scope

The change covers the existing React contact form, the Express application running in Lambda, SAM infrastructure, automated tests, and deployment documentation. It does not add a CRM, store message bodies in a database, send visitor confirmations, or provision CloudFront/WAF resources.

## Architecture

The browser renders Cloudflare Turnstile and submits JSON to `/api/contact` on the same origin. Express performs request validation, honeypot inspection, IP-based rate limiting, Turnstile verification, input normalization, and SES delivery. DynamoDB stores only opaque rate-limit keys and expiration timestamps; contact contents are never persisted.

The processing order is deliberately inexpensive-first:

1. Require JSON and reject oversized or malformed requests.
2. Validate the exact request schema and honeypot.
3. Apply the per-IP rate limit.
4. Verify the Turnstile token with Cloudflare.
5. Construct a plain-text email and send it with SES.
6. Return a minimal success response.

## Browser Form

The existing fields remain: name, company, email, service, and message. Name, email, service, and message are required; company is optional. A hidden `website` honeypot field and a Turnstile widget are added.

The form tracks `idle`, `submitting`, `success`, and `error` states. While submitting, controls are disabled and the button communicates progress. On success, the form resets and Turnstile is reset. On a recoverable error, typed values remain and the visitor receives a concise, accessible message. Duplicate clicks are suppressed.

The public Turnstile site key is supplied at Vite build time as `VITE_TURNSTILE_SITE_KEY`. The secret is never included in frontend code.

## Request Contract

`POST /api/contact` accepts `application/json` with this shape:

```json
{
  "name": "Jane Smith",
  "company": "Example Co",
  "email": "jane@example.com",
  "service": "Cloud Security",
  "message": "We need help reviewing our AWS environment.",
  "website": "",
  "turnstileToken": "token-from-widget"
}
```

Unknown fields are rejected. Limits are:

| Field | Required | Maximum |
| --- | --- | ---: |
| `name` | Yes | 100 characters |
| `company` | No | 150 characters |
| `email` | Yes | 254 characters |
| `service` | Yes | 100 characters |
| `message` | Yes | 5,000 characters |
| `website` | No; must be empty | 200 characters |
| `turnstileToken` | Yes | 2,048 characters |

Strings are trimmed, CRLF is normalized, NUL/control characters are removed from content fields, and header-bound values reject CR/LF outright. Email validation is intentionally conservative rather than attempting full RFC parsing. `service` must match the frontend allowlist.

Successful requests return HTTP 200 with `{ "ok": true }`. Validation errors return 400, CAPTCHA failures 400, rate limits 429 with `Retry-After`, unsupported media types 415, and unexpected delivery failures 500. Client responses do not expose Cloudflare, DynamoDB, SES, or stack details.

## Abuse Controls

Cloudflare Turnstile is verified server-side against its Siteverify endpoint. The Lambda sends the token, secret, and requester IP and requires `success: true`; network failures fail closed.

DynamoDB implements a fixed-window limit of five accepted attempts per IP hash per 15 minutes. The IP is HMAC-SHA-256 hashed with a deployment secret before use as a key. An atomic conditional update prevents concurrent requests from exceeding the limit. TTL removes expired records. Lambda Function URL `sourceIp` represents the immediate TCP peer, which is a CloudFront edge when CloudFront is present. The application therefore uses CloudFront's generated viewer-address header only when a private origin header matches the HMAC secret in constant time; otherwise it falls back to the immediate source address. Visitor-supplied forwarding headers are never trusted.

The honeypot produces a generic success response without calling SES, reducing bot feedback. Its attempt may still be logged as an abuse event.

## Email Delivery

SES sends a plain-text notification from a verified sender identity to a configured business recipient. The subject contains a fixed prefix and the allowlisted service; user content cannot create arbitrary headers. The validated visitor email is set as `Reply-To`.

The body includes name, company, email, service, submission time, and message. It excludes the Turnstile token and raw IP address. The recipient and sender are deployment parameters, not browser inputs.

## Configuration and IAM

SAM provisions:

- The existing Lambda Function URL and runtime.
- A DynamoDB table with on-demand billing and TTL.
- `dynamodb:UpdateItem` permission restricted to that table.
- `ses:SendEmail` permission restricted to the configured SES identity.
- Environment variables for recipient, sender, table name, rate window, rate maximum, Turnstile secret reference, and IP-hash secret reference.

Turnstile and HMAC secrets are stored in AWS Systems Manager Parameter Store as `SecureString` values and referenced by parameter name. Lambda receives permission to read only those named parameters. SAM accepts names and public configuration, not secret values, so secrets do not enter CloudFormation templates or source control.

Production SES identities must be verified. If the AWS account remains in the SES sandbox, the recipient must also be verified until production access is approved.

## Logging and Privacy

Structured logs include a request correlation ID, outcome category, HTTP status, and provider error class. They do not include message bodies, CAPTCHA tokens, full email addresses, secrets, or raw IP addresses. Validation failures identify field names but not rejected values.

## Testing

Backend unit tests cover valid normalization, every required field, size limits, unknown fields, service allowlisting, email/header injection, honeypot handling, Turnstile success/failure/network failure, atomic rate-limit results, SES parameters, provider failures, and HTTP status mapping.

Frontend tests cover payload construction, disabled submission state, accessible success/error messages, value retention after error, reset after success, and CAPTCHA reset. A build test confirms Vite emits the frontend. `sam validate` and `sam build` verify the infrastructure and packaging, including `dist/index.html` and the server files.

## Deployment and Operations

The README will document creating the two SecureString parameters, verifying SES identities, setting the Vite site key, building, validating, deploying through SAM, and testing the health and contact endpoints. It will also describe the SES sandbox constraint and CloudFront cache behavior: `/api/*` must not be cached, and POST must be forwarded to the Lambda origin.

## Success Criteria

- A legitimate visitor can submit once and the configured mailbox receives a readable inquiry.
- Invalid, oversized, automated, CAPTCHA-failing, and over-limit requests do not send email.
- No secret is present in browser assets, source files, or SAM parameter defaults.
- Contact contents are not persisted by the application.
- Automated tests, Vite build, SAM validation, and SAM build pass.
