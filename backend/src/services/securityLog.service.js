const SecurityLog = require("../models/SecurityLog.model");
const { SECURITY_SEVERITIES } = require("../config/constants");

const MAX_USER_AGENT_LENGTH = 200;

function sanitizeUserAgent(userAgent) {
  if (typeof userAgent !== "string") {
    return undefined;
  }
  const trimmed = userAgent.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.slice(0, MAX_USER_AGENT_LENGTH);
}

function sanitizeIpAddress(ipAddress) {
  if (typeof ipAddress !== "string") {
    return undefined;
  }
  const trimmed = ipAddress.trim();
  return trimmed ? trimmed.slice(0, 64) : undefined;
}

/**
 * Writes an append-only SecurityLog record.
 * Callers must NEVER pass raw document numbers, names on documents,
 * identity hashes, passwords, OTPs, or provider references in `details`.
 */
async function logSecurityEvent({
  eventType,
  severity = SECURITY_SEVERITIES.LOW,
  userId,
  walletAddress,
  eventId,
  ticketId,
  attemptedPricePaise,
  allowedMaxPricePaise,
  ipAddress,
  userAgent,
  details = {},
}) {
  return SecurityLog.create({
    eventType,
    severity,
    userId,
    walletAddress,
    eventId,
    ticketId,
    attemptedPricePaise,
    allowedMaxPricePaise,
    ipAddress: sanitizeIpAddress(ipAddress),
    userAgent: sanitizeUserAgent(userAgent),
    details,
  });
}

module.exports = {
  logSecurityEvent,
  sanitizeUserAgent,
  sanitizeIpAddress,
};
