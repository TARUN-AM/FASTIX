/**
 * Deterministic human-readable wallet linking challenge message builder.
 *
 * Exact format (rebuilt identically on the server during verification;
 * the backend NEVER trusts or verifies a client-supplied message):
 *
 * {domain} wants you to link this wallet to your FairTicket account.
 *
 * Wallet: {checksumAddress}
 *
 * This signature does not cost gas, does not move funds and does not give anyone permission to spend your assets.
 *
 * Chain ID: {chainId}
 * Nonce: {nonce}
 * Issued At: {issuedAt ISO}
 * Expires At: {expiresAt ISO}
 */
function toIsoTimestamp(value, fieldName) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`${fieldName} must be a valid Date or ISO timestamp.`);
  }
  return date.toISOString();
}

function buildChallengeMessage({
  domain,
  checksumAddress,
  nonce,
  issuedAt,
  expiresAt,
  chainId,
}) {
  if (typeof domain !== "string" || !domain.trim()) {
    throw new TypeError("domain is required to build a wallet challenge message.");
  }
  if (typeof checksumAddress !== "string" || !checksumAddress.trim()) {
    throw new TypeError(
      "checksumAddress is required to build a wallet challenge message."
    );
  }
  if (typeof nonce !== "string" || !nonce.trim()) {
    throw new TypeError("nonce is required to build a wallet challenge message.");
  }
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new TypeError("chainId must be a positive integer.");
  }

  const issuedAtIso = toIsoTimestamp(issuedAt, "issuedAt");
  const expiresAtIso = toIsoTimestamp(expiresAt, "expiresAt");

  return [
    `${domain.trim()} wants you to link this wallet to your FairTicket account.`,
    "",
    `Wallet: ${checksumAddress.trim()}`,
    "",
    "This signature does not cost gas, does not move funds and does not give anyone permission to spend your assets.",
    "",
    `Chain ID: ${chainId}`,
    `Nonce: ${nonce.trim()}`,
    `Issued At: ${issuedAtIso}`,
    `Expires At: ${expiresAtIso}`,
  ].join("\n");
}

module.exports = {
  buildChallengeMessage,
};
