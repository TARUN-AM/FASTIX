const crypto = require("crypto");
const { QR_TOKEN_TTL_SECONDS } = require("../config/constants");

/**
 * Short-lived signed entry QR tokens (ARCHITECTURE.md section 9.5).
 *
 * The QR carries ONLY { tid, eid, iat, exp, n } - no name, phone, email or wallet.
 * The HMAC is computed over the exact payload string that is transmitted, so there
 * is no JSON-canonicalisation ambiguity between signer and verifier.
 */
const MIN_SECRET_LENGTH = 16;

function getSecret(secretOverride) {
  const secret = secretOverride ?? process.env.QR_SIGNING_SECRET ?? "";
  if (typeof secret !== "string" || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `QR_SIGNING_SECRET must be set to at least ${MIN_SECRET_LENGTH} characters.`
    );
  }
  return secret;
}

function sign(payloadString, secret) {
  return crypto.createHmac("sha256", secret).update(payloadString).digest("hex");
}

function toBase64Url(text) {
  return Buffer.from(text, "utf8").toString("base64url");
}

function fromBase64Url(text) {
  return Buffer.from(text, "base64url").toString("utf8");
}

function generateQrToken({ onChainTicketId, onChainEventId, now = Date.now(), secret } = {}) {
  if (!Number.isSafeInteger(onChainTicketId) || onChainTicketId < 1) {
    throw new TypeError("onChainTicketId must be a positive integer");
  }
  if (!Number.isSafeInteger(onChainEventId) || onChainEventId < 1) {
    throw new TypeError("onChainEventId must be a positive integer");
  }
  const iat = Math.floor(now / 1000);
  const exp = iat + QR_TOKEN_TTL_SECONDS;
  const payload = JSON.stringify({
    tid: onChainTicketId,
    eid: onChainEventId,
    iat,
    exp,
    n: crypto.randomBytes(8).toString("hex"),
  });
  const sig = sign(payload, getSecret(secret));
  return {
    qrPayloadString: toBase64Url(JSON.stringify({ payload, sig })),
    issuedAt: new Date(iat * 1000).toISOString(),
    expiresAt: new Date(exp * 1000).toISOString(),
    ttlSeconds: QR_TOKEN_TTL_SECONDS,
  };
}

/**
 * Returns { valid, code, payload? }. Never throws on malformed input -
 * every failure maps to a stable code the gate service can log.
 * Order matters: signature is checked BEFORE expiry so forged tokens are
 * reported as QR_INVALID_SIGNATURE rather than leaking timing/expiry info.
 */
function verifyQrToken(qrPayloadString, { now = Date.now(), secret } = {}) {
  let envelope;
  try {
    envelope = JSON.parse(fromBase64Url(String(qrPayloadString)));
  } catch {
    return { valid: false, code: "QR_INVALID_SIGNATURE" };
  }
  if (
    !envelope ||
    typeof envelope.payload !== "string" ||
    typeof envelope.sig !== "string"
  ) {
    return { valid: false, code: "QR_INVALID_SIGNATURE" };
  }

  const expected = Buffer.from(sign(envelope.payload, getSecret(secret)), "hex");
  const provided = Buffer.from(envelope.sig, "hex");
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return { valid: false, code: "QR_INVALID_SIGNATURE" };
  }

  let payload;
  try {
    payload = JSON.parse(envelope.payload);
  } catch {
    return { valid: false, code: "QR_INVALID_SIGNATURE" };
  }
  if (!Number.isSafeInteger(payload.tid) || !Number.isSafeInteger(payload.eid) ||
      !Number.isSafeInteger(payload.exp)) {
    return { valid: false, code: "QR_INVALID_SIGNATURE" };
  }
  if (Math.floor(now / 1000) > payload.exp) {
    return { valid: false, code: "QR_EXPIRED", payload };
  }
  return { valid: true, code: null, payload };
}

module.exports = { generateQrToken, verifyQrToken };
