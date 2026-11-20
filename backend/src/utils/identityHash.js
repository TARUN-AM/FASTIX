const crypto = require("crypto");
const config = require("../config/env");
const { normalizeDocumentNumber } = require("./normalize");

/**
 * Computes a deterministic, privacy-preserving HMAC-SHA256 hex digest for a
 * verified identity document.
 *
 * Security rationale:
 * - A plain unsalted hash of an ID number can be reversed by brute-force guessing
 *   because ID formats have a relatively small keyspace, so we use a server-keyed
 *   HMAC-SHA256 instead of a plain hash.
 * - A random per-user salt would not work here because the same identity document
 *   must always produce the exact same reference so duplicate-identity detection
 *   can match across accounts.
 * - Therefore IDENTITY_HASH_SECRET must be kept strictly confidential, backed up
 *   securely, and never rotated casually after users have verified their identity.
 *
 * PRIVACY: Never log the inputs or the output of this function.
 */
function computeIdentityHash({ documentType, documentNumber }) {
  if (typeof documentType !== "string" || !documentType.trim()) {
    throw new TypeError("documentType must be a non-empty string.");
  }
  if (typeof documentNumber !== "string" || !documentNumber.trim()) {
    throw new TypeError("documentNumber must be a non-empty string.");
  }

  const normalizedType = documentType.trim().toUpperCase();
  const normalizedNumber = normalizeDocumentNumber(documentNumber);
  const payload = `fairticket:identity:v1:${normalizedType}:${normalizedNumber}`;

  return crypto
    .createHmac("sha256", config.identityHashSecret)
    .update(payload)
    .digest("hex");
}

module.exports = {
  computeIdentityHash,
};
