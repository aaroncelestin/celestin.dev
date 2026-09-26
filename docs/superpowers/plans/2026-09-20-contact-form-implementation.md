# Celestin.dev Contact Form Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production-ready React-to-Lambda contact workflow with strict validation, Cloudflare Turnstile, distributed DynamoDB rate limiting, and Amazon SES delivery.

**Architecture:** The React form submits same-origin JSON to an Express route. The route delegates to focused validation, abuse-control, CAPTCHA, secret-loading, and mail modules; AWS SDK v3 adapters provide DynamoDB, SSM, and SES access and are injected in tests. SAM provisions the Function URL, rate-limit table, environment configuration, and least-privilege permissions.

**Tech Stack:** React 18, Vite 8, Express, `@codegenie/serverless-express`, AWS SAM, AWS SDK for JavaScript v3, Cloudflare Turnstile, DynamoDB, SSM Parameter Store, Amazon SES v2, Vitest, Testing Library, Supertest.

**Spec:** `docs/superpowers/specs/2026-09-19-contact-form-design.md`

## Global Constraints

- Rate limit is five attempts per IP per 15-minute fixed window.
- Name, email, service, and message are required; company is optional.
- Maximum lengths are name 100, company 150, email 254, service 100, message 5,000, honeypot 200, and Turnstile token 2,048 characters.
- Contact contents must never be persisted by the application.
- Turnstile and IP-hash secrets must remain outside source code, browser assets, and CloudFormation defaults.
- Browser errors must not reveal Cloudflare, DynamoDB, SES, or stack details.
- Logs must not contain raw IPs, message bodies, CAPTCHA tokens, secrets, or full email addresses.
- SES messages are plain text; the visitor email may be used only as a separately validated `Reply-To` value.
- `/api/*` responses must not be cached by the application or CloudFront.

## Review Focus

- A JSON body containing arrays, objects, or numeric values instead of strings returns 400 without provider calls; pin in Task 2 validation tests.
- Unicode whitespace and CRLF input normalize predictably while NUL/control characters cannot enter the email; pin in Task 2 normalization tests.
- A spoofed `X-Forwarded-For` header cannot override the Lambda Function URL `requestContext.http.sourceIp`; pin in Task 4 route tests.
- Two concurrent requests at the fifth-request boundary cannot both pass; pin the DynamoDB conditional expression and conditional-failure mapping in Task 3.
- A successful SES send followed by a frontend reset does not leave a reusable Turnstile token; pin in Task 5 component tests.

---

## File Map

- `src/contact-options.js`: shared public service labels and form limits used by the browser.
- `src/TurnstileWidget.jsx`: explicit-render Turnstile lifecycle and reset interface.
- `src/ContactForm.jsx`: controlled form, API request, and accessible status handling.
- `src/App.jsx`: replaces the inline demo form with `ContactForm`.
- `src/styles.css`: form status, honeypot, disabled, and CAPTCHA styling.
- `server/contact-validation.mjs`: exact schema validation and safe normalization.
- `server/contact-infrastructure.mjs`: SSM secret cache, IP hashing, DynamoDB limiter, Turnstile verification, and SES delivery.
- `server/contact-handler.mjs`: provider-independent orchestration and stable HTTP results.
- `server/app.mjs`: Express factory, source-IP extraction, route wiring, error handling, static site serving, and Lambda export.
- `tests/server/*.test.mjs`: backend unit and HTTP contract coverage.
- `tests/client/*.test.jsx`: browser request and state coverage.
- `template.yaml`: AWS resources, parameters, IAM, environment, and Function URL output.
- `.env.example`: public local-build configuration only.
- `.gitignore`: excludes secrets, build output, dependencies, and SAM output while allowing the build workflow to package `dist` via Makefile.
- `Makefile`: deterministic Vite build and Lambda artifact assembly.
- `README.md`: local testing, secure configuration, SES setup, SAM deployment, and CloudFront behavior.

### Task 1: Establish the testable project boundary

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `vitest.config.js`
- Create: `src/contact-options.js`
- Create: `tests/client/setup.js`
- Test: `tests/client/contact-options.test.js`

**Interfaces:**
- Produces: `SERVICE_OPTIONS: readonly string[]` and `CONTACT_LIMITS: Record<string, number>`.
- Produces: npm scripts `test`, `test:watch`, and `test:coverage` used by every later task.

- [x] **Step 1: Write a failing shared-options test**

```js
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
```

- [x] **Step 2: Add test tooling and verify the red test**

Add scripts:

```json
"test": "vitest run",
"test:watch": "vitest",
"test:coverage": "vitest run --coverage"
```

Install development dependencies:

```bash
npm install --save-dev vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event supertest
npm test -- tests/client/contact-options.test.js
```

Expected: FAIL because `src/contact-options.js` does not exist.

- [x] **Step 3: Implement the shared constants**

```js
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
```

Configure Vitest for jsdom client tests and Node server tests, with `tests/client/setup.js` importing `@testing-library/jest-dom/vitest`.

- [x] **Step 4: Run the test suite**

Run: `npm test -- tests/client/contact-options.test.js`

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.js src/contact-options.js tests/client
git commit -m "test: establish contact form test harness"
```

### Task 2: Validate and normalize contact submissions

**Files:**
- Create: `server/contact-validation.mjs`
- Test: `tests/server/contact-validation.test.mjs`

**Interfaces:**
- Consumes: the same exact service strings and limits defined in `src/contact-options.js` (duplicate immutable server constants are acceptable because Lambda must not import browser modules).
- Produces: `validateContactPayload(value): { ok: true, data: ContactData } | { ok: false, fields: string[] }`.
- `ContactData` contains normalized string properties `name`, `company`, `email`, `service`, `message`, `website`, and `turnstileToken`.

- [x] **Step 1: Write failing validation tests**

Cover:

```js
it.each([null, [], "text", 42])("rejects a non-object payload: %j", (body) => {
  expect(validateContactPayload(body)).toEqual({ ok: false, fields: ["request"] });
});

it("normalizes safe text and rejects unknown properties", () => {
  const valid = validateContactPayload({
    name: "  Jane\u00a0Smith  ", company: " Example\r\nCo ",
    email: " jane@example.com ", service: "Cloud Security",
    message: "Line one\r\nLine two\u0000", website: "", turnstileToken: "token",
  });
  expect(valid.data).toMatchObject({
    name: "Jane Smith", company: "Example\nCo", email: "jane@example.com",
    message: "Line one\nLine two",
  });
  expect(validateContactPayload({ ...validFixture, extra: "no" })).toEqual({
    ok: false, fields: ["request"],
  });
});

it.each([
  ["name", ""], ["email", "not-an-email"], ["email", "a@b.com\r\nBcc:x@y.com"],
  ["service", "Invented Service"], ["message", ""], ["turnstileToken", ""],
  ["company", 5], ["message", { text: "hello" }],
])("rejects invalid %s", (field, value) => {
  expect(validateContactPayload({ ...validFixture, [field]: value }).ok).toBe(false);
});
```

Also test every maximum at the boundary and one character beyond it.

- [x] **Step 2: Run validation tests to verify they fail**

Run: `npm test -- tests/server/contact-validation.test.mjs`

Expected: FAIL because the validation module does not exist.

- [x] **Step 3: Implement exact-schema validation**

Implement these pure helpers:

```js
export function normalizeText(value, { singleLine = false } = {}) {
  const normalized = value.normalize("NFKC").replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  return singleLine
    ? normalized.replace(/[\s\u00A0]+/g, " ").trim()
    : normalized.split("\n").map((line) => line.trimEnd()).join("\n").trim();
}
```

Reject non-plain objects, unknown keys, non-string fields, CR/LF in email, invalid email syntax, values beyond limits, non-allowlisted services, and missing required values. Return a sorted, de-duplicated field list and never echo rejected values.

- [x] **Step 4: Run validation tests**

Run: `npm test -- tests/server/contact-validation.test.mjs`

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add server/contact-validation.mjs tests/server/contact-validation.test.mjs
git commit -m "feat: validate contact submissions"
```

### Task 3: Implement secrets, rate limiting, Turnstile, and SES adapters

**Files:**
- Create: `server/contact-infrastructure.mjs`
- Test: `tests/server/contact-infrastructure.test.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: `createSecretLoader({ ssmClient, turnstileParameterName, ipHashParameterName })` returning async `loadSecrets()` with warm-invocation caching.
- Produces: `hashIp(ip, secret): string` returning a lowercase hex HMAC-SHA-256 digest.
- Produces: `createRateLimiter({ dynamoClient, tableName, maxAttempts, windowSeconds, now })` returning async `check(ipHash): { allowed: boolean, retryAfter: number }`.
- Produces: `verifyTurnstile({ token, ip, secret, fetchImpl }): Promise<boolean>`.
- Produces: `createMailer({ sesClient, sender, recipient, now })` returning async `send(contact): Promise<void>`.

- [x] **Step 1: Write failing infrastructure adapter tests**

Use fake clients with a `send(command)` method. Assert:

```js
expect(hashIp("203.0.113.8", "secret")).toMatch(/^[a-f0-9]{64}$/);
expect(hashIp("203.0.113.8", "secret")).not.toContain("203.0.113.8");
```

For DynamoDB, inspect the command input and require:

```js
expect(input).toMatchObject({
  TableName: "rate-table",
  Key: { rateKey: { S: expect.stringContaining(":") } },
  UpdateExpression: "ADD attemptCount :one SET expiresAt = if_not_exists(expiresAt, :expiresAt)",
  ConditionExpression: "attribute_not_exists(attemptCount) OR attemptCount < :maxAttempts",
});
```

Simulate `ConditionalCheckFailedException` and expect `{ allowed: false, retryAfter: 900 }`. Confirm other DynamoDB errors are thrown. Fire two `check()` calls through a fake atomic store initialized at four and assert exactly one result is allowed.

For Turnstile, assert the request uses `POST`, `application/x-www-form-urlencoded`, `secret`, `response`, and `remoteip`, returns true only for `{ success: true }`, and returns false for rejected tokens, malformed responses, timeouts, and network failures.

For SES, assert `FromEmailAddress`, `Destination.ToAddresses`, `ReplyToAddresses`, a fixed subject prefix, and a plain-text body containing normalized contact fields. Assert no HTML body is created.

For SSM, assert two `GetParameterCommand` calls use `WithDecryption: true`, missing values throw a configuration error, and a second `loadSecrets()` call uses the warm cache.

- [x] **Step 2: Install AWS SDK dependencies and run the red tests**

```bash
npm install @aws-sdk/client-dynamodb @aws-sdk/client-ssm @aws-sdk/client-sesv2 @codegenie/serverless-express express
npm test -- tests/server/contact-infrastructure.test.mjs
```

Expected: FAIL because the infrastructure module does not exist.

- [x] **Step 3: Implement the adapters**

Use `createHmac` from `node:crypto`; `GetParameterCommand` with decryption; `UpdateItemCommand` with a key of `${ipHash}:${windowStart}`; the Turnstile Siteverify URL `https://challenges.cloudflare.com/turnstile/v0/siteverify`; an `AbortSignal.timeout(5000)` timeout; and `SendEmailCommand` from SES v2.

Map only DynamoDB `ConditionalCheckFailedException` to a denied rate decision. Escape no HTML because email is plain text, but construct headers only from configured sender/recipient and the separately validated email.

- [x] **Step 4: Run infrastructure tests**

Run: `npm test -- tests/server/contact-infrastructure.test.mjs`

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add package.json package-lock.json server/contact-infrastructure.mjs tests/server/contact-infrastructure.test.mjs
git commit -m "feat: add contact security and delivery adapters"
```

### Task 4: Orchestrate and expose `POST /api/contact`

**Files:**
- Create: `server/contact-handler.mjs`
- Modify: `server/app.mjs`
- Test: `tests/server/contact-handler.test.mjs`
- Test: `tests/server/app.test.mjs`

**Interfaces:**
- Produces: `createContactHandler({ validate, loadSecrets, rateLimiter, verifyCaptcha, mailer, hashIp, logger })` returning `handle({ body, ip, requestId })`.
- Produces: `createApp(overrides = {})` for HTTP tests and `handler` for Lambda.
- Consumes: Task 2 `validateContactPayload` and Task 3 infrastructure interfaces.

- [x] **Step 1: Write failing orchestration tests**

Assert the ordered outcomes:

- Invalid payload: 400 and no secret, limiter, CAPTCHA, or SES call.
- Honeypot populated: 200 generic success and no provider call.
- Rate limit denied: 429 with `retryAfter` and no CAPTCHA/SES call.
- Turnstile rejected or unavailable: 400 and no SES call.
- SES failure: 500 generic response.
- Full success: 200 `{ ok: true }` and one SES call.
- Logger events contain request ID and outcome but none of the raw IP, email, message, token, or secrets.

- [x] **Step 2: Run handler tests to verify they fail**

Run: `npm test -- tests/server/contact-handler.test.mjs`

Expected: FAIL because `createContactHandler` does not exist.

- [x] **Step 3: Implement orchestration with stable results**

Return objects shaped as:

```js
{ status: 200, body: { ok: true }, headers: {} }
{ status: 400, body: { ok: false, error: "Please check the highlighted fields." }, headers: {} }
{ status: 429, body: { ok: false, error: "Too many requests. Please try again later." }, headers: { "Retry-After": "900" } }
{ status: 500, body: { ok: false, error: "We could not send your request. Please try again later." }, headers: {} }
```

Keep validation/provider error detail only in safe structured log categories.

- [x] **Step 4: Write failing Express contract tests**

With Supertest and dependency overrides, test:

```js
await request(app).post("/api/contact").set("Content-Type", "text/plain").send("x").expect(415);
await request(app).post("/api/contact").send(validFixture).expect(200, { ok: true });
await request(app).get("/api/missing").expect(404, { ok: false, error: "API endpoint not found." });
```

Attach a fake Lambda event with `requestContext.http.sourceIp = "198.51.100.10"` and a conflicting `X-Forwarded-For: 203.0.113.99`; assert the handler receives `198.51.100.10`. Assert every `/api/` response includes `Cache-Control: no-store`.

- [x] **Step 5: Refactor `server/app.mjs` into a factory and wire production clients**

Implement `createApp(overrides = {})`; use `req.apiGateway?.event?.requestContext?.http?.sourceIp` as the production source IP, falling back to `req.socket.remoteAddress` only outside Lambda. Reject non-JSON contact requests before the controller. Keep `/api/health`, static `dist`, an API-only 404, and an SPA fallback.

Create production SDK clients once per warm Lambda environment, build the dependencies from environment variables, and export:

```js
export const app = createApp();
export const handler = serverlessExpress({ app });
```

- [x] **Step 6: Run backend HTTP tests**

Run: `npm test -- tests/server/contact-handler.test.mjs tests/server/app.test.mjs`

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add server/contact-handler.mjs server/app.mjs tests/server/contact-handler.test.mjs tests/server/app.test.mjs
git commit -m "feat: expose secure contact endpoint"
```

### Task 5: Build the Turnstile-enabled React form

**Files:**
- Create: `src/TurnstileWidget.jsx`
- Create: `src/ContactForm.jsx`
- Modify: `src/App.jsx`
- Modify: `src/styles.css`
- Test: `tests/client/ContactForm.test.jsx`

**Interfaces:**
- `TurnstileWidget({ siteKey, onToken, resetSignal })` invokes `onToken(token)` on solve and `onToken("")` on expiry/error.
- `ContactForm({ fetchImpl = fetch, siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY })` submits to `/api/contact`.
- Consumes: Task 1 `SERVICE_OPTIONS` and `CONTACT_LIMITS`.

- [x] **Step 1: Write failing form tests**

Mock `TurnstileWidget` so tests can issue a token. Cover:

```jsx
it("submits the exact JSON payload and disables duplicate submission", async () => {
  const pending = deferred();
  const fetchImpl = vi.fn(() => pending.promise);
  render(<ContactForm fetchImpl={fetchImpl} siteKey="site-key" />);
  await fillValidForm(user);
  await user.click(screen.getByRole("button", { name: /send request/i }));
  expect(fetchImpl).toHaveBeenCalledWith("/api/contact", expect.objectContaining({
    method: "POST",
    headers: { "Content-Type": "application/json" },
  }));
  expect(screen.getByRole("button")).toBeDisabled();
  await user.click(screen.getByRole("button"));
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});
```

Also assert missing CAPTCHA blocks submission, an HTTP error preserves typed values and shows an alert, success resets all fields and changes `resetSignal`, and the payload includes `website: ""` plus the token without extra fields.

- [x] **Step 2: Run client tests to verify they fail**

Run: `npm test -- tests/client/ContactForm.test.jsx`

Expected: FAIL because `ContactForm` does not exist.

- [x] **Step 3: Implement `TurnstileWidget`**

Load `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit` once, render into a ref with the configured site key, store the widget ID, reset it when `resetSignal` changes, and remove the widget on unmount. Render an accessible configuration error when the site key is absent. Do not put the secret in this component.

- [x] **Step 4: Implement `ContactForm` and integrate it**

Use controlled fields, HTML `required`/`maxLength`, the shared service list, a visually hidden honeypot with `tabIndex={-1}` and `autoComplete="off"`, and an `aria-live="polite"` status region. Parse response JSON defensively and show generic fallback copy when it is absent or malformed.

Replace the inline `<form>` in `App.jsx` with `<ContactForm />`; remove the old alert. Add styles for `.form-status`, `.form-status.error`, `.form-status.success`, `.honeypot-field`, disabled controls, and the Turnstile container while preserving the current visual system.

- [x] **Step 5: Run client tests and production build**

```bash
npm test -- tests/client/ContactForm.test.jsx
VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA npm run build
```

Expected: tests PASS and `dist/index.html` exists.

- [x] **Step 6: Commit**

```bash
git add src/TurnstileWidget.jsx src/ContactForm.jsx src/App.jsx src/styles.css tests/client/ContactForm.test.jsx
git commit -m "feat: connect contact form to secure API"
```

### Task 6: Provision the SAM resources and deterministic build

**Files:**
- Replace: `template.yaml`
- Create: `Makefile`
- Create: `.gitignore`
- Create: `.env.example`
- Test: `tests/server/template.test.mjs`

**Interfaces:**
- Produces CloudFormation parameters `ContactSenderEmail`, `ContactRecipientEmail`, `SesIdentity`, `TurnstileSecretParameterName`, and `IpHashSecretParameterName`.
- Produces environment variables `CONTACT_SENDER_EMAIL`, `CONTACT_RECIPIENT_EMAIL`, `RATE_LIMIT_TABLE`, `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_SECONDS`, `TURNSTILE_SECRET_PARAMETER_NAME`, and `IP_HASH_SECRET_PARAMETER_NAME`.
- Produces outputs `CelestinDevSiteArn` and `CelestinDevSiteUrl`.

- [x] **Step 1: Write a failing template contract test**

Read `template.yaml` as text and assert it contains the function, Function URL, DynamoDB table with TTL, all parameters/environment names, scoped `ses:SendEmail`, `ssm:GetParameter`, and `dynamodb:UpdateItem` statements, plus outputs that reference `CelestinDevSite` and `CelestinDevSiteUrl`. Assert it contains neither a secret value nor a parameter default for either secret parameter.

- [x] **Step 2: Run the template test to verify it fails**

Run: `npm test -- tests/server/template.test.mjs`

Expected: FAIL against the original sample template.

- [x] **Step 3: Replace the SAM template**

Use `CodeUri: .`, `Handler: server/app.handler`, `Runtime: nodejs24.x`, `Architectures: [arm64]`, timeout 10 seconds, memory 512 MB, a public Function URL, and a DynamoDB table with `rateKey` string hash key, `PAY_PER_REQUEST`, and TTL attribute `expiresAt`.

Set resource metadata to `BuildMethod: makefile` so SAM invokes the deterministic packaging target.

Use explicit IAM statements scoped to:

```yaml
Resource: !GetAtt ContactRateLimitTable.Arn
Resource: !Sub arn:${AWS::Partition}:ses:${AWS::Region}:${AWS::AccountId}:identity/${SesIdentity}
Resource:
  - !Sub arn:${AWS::Partition}:ssm:${AWS::Region}:${AWS::AccountId}:parameter${TurnstileSecretParameterName}
  - !Sub arn:${AWS::Partition}:ssm:${AWS::Region}:${AWS::AccountId}:parameter${IpHashSecretParameterName}
```

Validate parameter patterns so SSM names start with `/` and email parameters are non-empty.

- [x] **Step 4: Add deterministic packaging**

Create a Makefile target `build-CelestinDevSite` that runs `npm ci`, runs Vite with the externally supplied `VITE_TURNSTILE_SITE_KEY`, copies `dist/`, `server/`, `package.json`, and `package-lock.json` to `$(ARTIFACTS_DIR)`, then runs `npm ci --omit=dev` inside the artifact directory. Do not copy the source `node_modules` directory.

Create `.gitignore` containing `node_modules/`, `dist/`, `.aws-sam/`, `.env`, `.env.*`, with `!.env.example`. The Makefile explicitly copies the generated `dist`, so its gitignored state cannot silently omit it.

Create `.env.example` containing only:

```dotenv
VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA
```

- [ ] **Step 5: Run template and SAM verification**

```bash
npm test -- tests/server/template.test.mjs
sam validate --lint
rm -rf .aws-sam
VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA sam build
test -f .aws-sam/build/CelestinDevSite/dist/index.html
test -f .aws-sam/build/CelestinDevSite/server/app.mjs
```

Expected: all commands succeed.

- [x] **Step 6: Commit**

```bash
git add template.yaml Makefile .gitignore .env.example tests/server/template.test.mjs
git commit -m "feat: provision contact form infrastructure"
```

### Task 7: Document secure setup and complete verification

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-09-20-contact-form-implementation.md` (check completed steps)

**Interfaces:**
- Documents the exact prerequisites and commands needed to configure and deploy the interfaces produced by Tasks 1–6.

- [x] **Step 1: Write the operational runbook**

Document:

1. Create a Turnstile widget for `celestin.dev` and `www.celestin.dev` and keep the site key separate from the secret.
2. Put the Turnstile secret and a generated 32-byte IP-hash secret in two SSM `SecureString` parameters:

```bash
aws ssm put-parameter --name /celestin-dev/turnstile-secret --type SecureString --value 'REPLACE_WITH_TURNSTILE_SECRET'
openssl rand -hex 32
aws ssm put-parameter --name /celestin-dev/ip-hash-secret --type SecureString --value 'REPLACE_WITH_RANDOM_HEX'
```

3. Verify the sender/domain identity in SES, explain sandbox recipient verification, and request production access when needed.
4. Install, test, validate, build, and deploy:

```bash
npm ci
npm test
sam validate --lint
VITE_TURNSTILE_SITE_KEY='REPLACE_WITH_SITE_KEY' sam build
sam deploy --guided \
  --parameter-overrides \
  ContactSenderEmail='website@celestin.dev' \
  ContactRecipientEmail='REPLACE_WITH_BUSINESS_MAILBOX' \
  SesIdentity='celestin.dev' \
  TurnstileSecretParameterName='/celestin-dev/turnstile-secret' \
  IpHashSecretParameterName='/celestin-dev/ip-hash-secret'
```

5. Test `/api/health`, the browser form, CloudWatch log outcomes, and mailbox delivery.
6. Configure CloudFront `/api/*` with caching disabled, all required methods, request bodies forwarded, and no cached error responses.
7. Explain safe rollback through the previous CloudFormation/SAM artifact and that deleting the stack also deletes the rate table unless retention is later added.

- [ ] **Step 2: Run the complete verification suite**

```bash
npm test
VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA npm run build
sam validate --lint
rm -rf .aws-sam
VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA sam build
test -f .aws-sam/build/CelestinDevSite/dist/index.html
test -f .aws-sam/build/CelestinDevSite/server/contact-handler.mjs
test -f .aws-sam/build/CelestinDevSite/server/contact-infrastructure.mjs
```

Expected: every command succeeds with no failing or skipped tests.

- [x] **Step 3: Perform a secret and artifact scan**

```bash
rg -n "TURNSTILE_SECRET=|REPLACE_WITH_RANDOM_HEX|BEGIN (RSA|OPENSSH|EC) PRIVATE KEY" . \
  --glob '!node_modules/**' --glob '!.aws-sam/**' --glob '!dist/**'
```

Expected: only documentation placeholders appear; no actual secret or private key exists.

- [x] **Step 4: Commit documentation**

```bash
git add README.md docs/superpowers/plans/2026-09-20-contact-form-implementation.md
git commit -m "docs: add contact form deployment runbook"
```

- [x] **Step 5: Complete final review**

Review the complete diff against `docs/superpowers/specs/2026-09-19-contact-form-design.md`, with special attention to secret handling, raw-IP trust, provider failure behavior, IAM resource scope, and absence of sensitive log data. Resolve all blocking findings, rerun Step 2, and package the verified project without `node_modules`, `dist`, or `.aws-sam`.

Native execution used a structured self-review because independent subagent dispatch was not authorized in this session. The review fixed CloudFront-shared client identity and consumed-CAPTCHA retry behavior. The full automated suite and deterministic Makefile package pass; SAM CLI validation remains a deployment-workstation check because `sam` is unavailable in this environment.
