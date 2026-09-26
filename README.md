# Celestin Industries Website

React/Vite single-page website with an Express application deployed to AWS Lambda through SAM. The contact workflow uses Cloudflare Turnstile, a DynamoDB per-IP rate limit, SSM SecureString parameters, and Amazon SES.

## Contact flow

`POST /api/contact` validates and normalizes an exact JSON schema, silently absorbs honeypot submissions, allows five attempts per hashed IP in a 15-minute fixed window, verifies Turnstile, and sends a plain-text SES message. Contact contents are not stored in DynamoDB; the table contains only opaque HMAC keys, counters, and TTL timestamps.

## Prerequisites

- Node.js 24 and npm
- AWS CLI authenticated to the deployment account
- AWS SAM CLI
- An AWS Region with Lambda, DynamoDB, SSM Parameter Store, and SES
- A Cloudflare account for Turnstile

Use the same AWS Region for the SAM stack, SSM parameters, and SES identity.

## 1. Configure Cloudflare Turnstile

Create a Turnstile widget and allow both production hostnames:

- `celestin.dev`
- `www.celestin.dev`

Turnstile provides two different values:

- The **site key** is public and is embedded into the Vite browser bundle at build time.
- The **secret key** is private and belongs only in SSM Parameter Store.

Never put the secret in `.env`, `template.yaml`, source control, or a `VITE_*` variable. Vite exposes every `VITE_*` value to browsers.

## 2. Store the server-side secrets

Create two SSM `SecureString` parameters. Replace the placeholders without committing their real values:

```bash
aws ssm put-parameter \
  --name /celestin-dev/turnstile-secret \
  --type SecureString \
  --value 'REPLACE_WITH_TURNSTILE_SECRET'

openssl rand -hex 32

aws ssm put-parameter \
  --name /celestin-dev/ip-hash-secret \
  --type SecureString \
  --value 'REPLACE_WITH_RANDOM_HEX'
```

Use the random output only as the second parameter value. Avoid leaving real secret values in shell history. The Lambda role is limited to reading the two parameter names supplied during deployment.

## 3. Verify the SES identity

Verify `celestin.dev` as an SES domain identity in the deployment Region and add the DKIM DNS records SES provides. The default sender in the deployment example is `website@celestin.dev`; domain verification authorizes that address.

New SES accounts normally begin in the sandbox. While the account is in the sandbox, the destination business mailbox must also be verified. Request SES production access before accepting contact from the public so the form can deliver to an unverified recipient.

Check identity status before deploying:

```bash
aws sesv2 get-email-identity --email-identity celestin.dev
```

## 4. Install and test

Do not reuse `node_modules` copied from a ZIP or another platform. Install from the lockfile:

```bash
npm ci
npm test
```

For a local frontend build, copy `.env.example` to `.env.local` and replace its test site key with the production Turnstile site key. `.env.local` is ignored by Git.

```bash
cp .env.example .env.local
npm run build
```

Cloudflare's public test site key in `.env.example` is suitable for automated builds only.

## 5. Validate, build, and deploy with SAM

Validate before building:

```bash
sam validate --lint
```

Build with the public Turnstile site key. The Makefile runs Vite, copies `dist/` and `server/`, and installs production-only Lambda dependencies into the SAM artifact:

```bash
VITE_TURNSTILE_SITE_KEY='REPLACE_WITH_SITE_KEY' sam build
```

Confirm the artifact contains both halves of the application:

```bash
test -f .aws-sam/build/CelestinDevSite/dist/index.html
test -f .aws-sam/build/CelestinDevSite/server/app.mjs
test -f .aws-sam/build/CelestinDevSite/server/contact-handler.mjs
```

Deploy the stack:

```bash
sam deploy --guided \
  --parameter-overrides \
  ContactSenderEmail='website@celestin.dev' \
  ContactRecipientEmail='REPLACE_WITH_BUSINESS_MAILBOX' \
  SesIdentity='celestin.dev' \
  TurnstileSecretParameterName='/celestin-dev/turnstile-secret' \
  IpHashSecretParameterName='/celestin-dev/ip-hash-secret'
```

Recommended first-deployment answers:

- Stack name: `celestindev`
- Region: the Region containing the SES identity and SSM parameters
- Confirm changes before deploy: `Y`
- Allow SAM CLI IAM role creation: `Y`
- Disable rollback: `N`
- Save arguments to `samconfig.toml`: `Y`

The template does not accept either secret value. It accepts only SSM parameter names.

## 6. Configure CloudFront for the API

The browser uses same-origin `/api/contact`, so CloudFront must forward API requests to the Lambda Function URL rather than cache them.

First, add a private custom header to the Lambda Function URL origin:

- Header name: `X-Celestin-Origin-Verify`
- Header value: the same random value stored in `/celestin-dev/ip-hash-secret`

Do not expose that value in source control, screenshots, browser code, or viewer-facing response headers. CloudFront overwrites the origin custom header on forwarded requests. The application compares it in constant time before trusting CloudFront viewer metadata; direct Function URL requests fall back to their immediate connection address.

Create a custom origin request policy for `/api/*` that forwards `Content-Type` and CloudFront's generated `CloudFront-Viewer-Address` header, but not the viewer's `Host` header. Then create or verify a behavior with path pattern `/api/*` and these settings:

- Origin: the existing Lambda Function URL origin
- Viewer protocol: redirect HTTP to HTTPS
- Allowed methods: `GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE`
- Cache policy: managed `CachingDisabled`
- Origin request policy: the custom API policy described above
- Compress objects automatically: allowed

The `Host` header must resolve to the Lambda Function URL origin, while request bodies and the generated viewer address are forwarded. Do not trust or forward a viewer-supplied substitute for `CloudFront-Viewer-Address`. Do not add a custom error response that caches `/api/*` failures. The application also sends `Cache-Control: no-store` on every API response.

After saving the behavior, invalidate cached site assets when deploying a new frontend build if immediate activation is required.

## 7. Verify production

Test the Function URL directly first, then the CloudFront hostname:

```bash
curl -i https://REPLACE_WITH_FUNCTION_URL/api/health
curl -i https://www.celestin.dev/api/health
```

Both should return HTTP 200 JSON and `Cache-Control: no-store`.

Submit one browser inquiry and confirm:

1. Turnstile completes.
2. The form shows a success message and clears its values.
3. The configured mailbox receives a plain-text message.
4. Replying addresses the visitor's validated email.
5. CloudWatch logs show a `sent` outcome without the message, full email address, raw IP, or CAPTCHA token.

Expected safe log outcomes include `sent`, `validation_failed`, `honeypot`, `rate_limited`, `captcha_failed`, and `provider_error`.

## Troubleshooting

### The form reports a delivery error

- Confirm both SSM parameter names exist in the same Region as Lambda.
- Confirm the Lambda role can decrypt the parameters' KMS key if a customer-managed key is used.
- Confirm the SES identity is verified in the same Region.
- If SES is still sandboxed, verify the recipient mailbox.
- Inspect the Lambda log outcome and error class; sensitive submission values are intentionally omitted.

### The form works through the Function URL but not CloudFront

- Confirm `/api/*` uses the Lambda origin.
- Confirm POST is an allowed method.
- Confirm the cache policy is `CachingDisabled`.
- Confirm the custom origin header matches the IP-hash SecureString value.
- Confirm the origin request policy adds `CloudFront-Viewer-Address`, forwards `Content-Type`, and does not forward the viewer's `Host` header.

### CAPTCHA always fails

- Confirm the Vite build used the correct public site key.
- Confirm the matching secret is stored in the configured SSM parameter.
- Confirm the Turnstile widget allows both production hostnames.

## Rollback

Redeploy the previously known-good Git commit or previously packaged SAM artifact to the same stack. CloudFormation will update the Lambda code and any changed resources while retaining the stack identity.

Do not delete the stack as a routine rollback. The rate-limit table currently has no retention policy, so stack deletion also deletes that table. The table contains no contact messages, but deletion still removes its active counters.

## Development commands

```bash
npm run dev
npm test
VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA npm run build
```
