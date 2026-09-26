const SUCCESS = Object.freeze({ status: 200, body: { ok: true }, headers: {} });
const VALIDATION_ERROR = Object.freeze({
  status: 400,
  body: { ok: false, error: "Please check the highlighted fields." },
  headers: {},
});
const CAPTCHA_ERROR = Object.freeze({
  status: 400,
  body: { ok: false, error: "Please verify that you are human and try again." },
  headers: {},
});
const SERVER_ERROR = Object.freeze({
  status: 500,
  body: { ok: false, error: "We could not send your request. Please try again later." },
  headers: {},
});

export function createContactHandler({
  validate,
  loadSecrets,
  rateLimiter,
  verifyCaptcha,
  mailer,
  hashIp,
  resolveIp,
  logger = console,
}) {
  return async function handle({ body, ip, viewerAddress, originProof, requestId }) {
    const validation = validate(body);
    if (!validation.ok) {
      logger.warn({ requestId, outcome: "validation_failed", fields: validation.fields });
      return VALIDATION_ERROR;
    }

    const contact = validation.data;
    if (contact.website) {
      logger.warn({ requestId, outcome: "honeypot" });
      return SUCCESS;
    }

    try {
      const { turnstileSecret, ipHashSecret } = await loadSecrets();
      const clientIp = resolveIp({
        sourceIp: ip,
        viewerAddress,
        originProof,
      }, ipHashSecret);
      const ipDigest = hashIp(clientIp, ipHashSecret);
      const limit = await rateLimiter(ipDigest);
      if (!limit.allowed) {
        logger.warn({ requestId, outcome: "rate_limited" });
        return {
          status: 429,
          body: { ok: false, error: "Too many requests. Please try again later." },
          headers: { "Retry-After": String(limit.retryAfter) },
        };
      }

      let verified = false;
      try {
        verified = await verifyCaptcha({
          token: contact.turnstileToken,
          ip: clientIp,
          secret: turnstileSecret,
        });
      } catch {
        verified = false;
      }
      if (!verified) {
        logger.warn({ requestId, outcome: "captcha_failed" });
        return CAPTCHA_ERROR;
      }

      await mailer(contact);
      logger.info({ requestId, outcome: "sent" });
      return SUCCESS;
    } catch (error) {
      logger.error({
        requestId,
        outcome: "provider_error",
        errorClass: error?.name || "Error",
      });
      return SERVER_ERROR;
    }
  };
}
