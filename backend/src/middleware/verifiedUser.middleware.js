const mongoose = require("mongoose");
const SecurityLog = require("../models/SecurityLog.model");
const {
  IDENTITY_STATUSES,
  ERROR_CODES,
  SECURITY_EVENT_TYPES,
  SECURITY_SEVERITIES,
} = require("../config/constants");
const { sendError } = require("../utils/apiResponse");
const { logSecurityEvent } = require("../services/securityLog.service");

const DEDUP_WINDOW_MS = 10 * 60 * 1000;

// In-process dedup cache (keyed by userId + routePath) prevents rapid parallel bursts
// from writing duplicate UNVERIFIED_ACCESS_ATTEMPT logs within the 10-minute window.
const recentUnverifiedLogByKey = new Map();

function getRoutePath(req) {
  const baseUrl = req.baseUrl || "";
  const routePath = req.route && req.route.path ? req.route.path : req.path || "";
  return `${baseUrl}${routePath}` || req.originalUrl || "/";
}

async function recordUnverifiedAttempt(req, failedCheck) {
  if (mongoose.connection.readyState !== 1) {
    return;
  }

  const userId = req.user._id || req.user.id;
  const routePath = getRoutePath(req);
  const dedupKey = `${String(userId)}:${routePath}`;
  const nowMs = Date.now();
  const lastLoggedMs = recentUnverifiedLogByKey.get(dedupKey) || 0;

  if (nowMs - lastLoggedMs < DEDUP_WINDOW_MS) {
    return;
  }

  // Reserve slot synchronously before awaiting DB lookup to absorb concurrent bursts
  recentUnverifiedLogByKey.set(dedupKey, nowMs);

  try {
    const windowStart = new Date(nowMs - DEDUP_WINDOW_MS);
    const existing = await SecurityLog.exists({
      userId,
      eventType: SECURITY_EVENT_TYPES.UNVERIFIED_ACCESS_ATTEMPT,
      "details.routePath": routePath,
      createdAt: { $gte: windowStart },
    });

    if (existing) {
      return;
    }

    await logSecurityEvent({
      eventType: SECURITY_EVENT_TYPES.UNVERIFIED_ACCESS_ATTEMPT,
      severity: SECURITY_SEVERITIES.LOW,
      userId,
      ipAddress: req.ip || req.socket?.remoteAddress || "",
      userAgent: req.get ? req.get("user-agent") || "" : req.headers?.["user-agent"] || "",
      details: {
        routePath,
        method: req.method,
        failedCheck,
      },
    });
  } catch (_err) {
    // Never block a 403 gate response if audit logging fails
    recentUnverifiedLogByKey.delete(dedupKey);
  }
}

/**
 * Reusable verification gate middleware to run AFTER `authenticate` and
 * `requireRole(USER_ROLES.CUSTOMER)`.
 *
 * Prompt 11 (queue) and later prompts (booking, resale) will apply this
 * middleware to protected customer routes.
 *
 * Always reads live verification fields from `req.user` (loaded fresh from
 * MongoDB by `authenticate`), never from JWT claims.
 */
function requireVerifiedUser(options = { requireWallet: false }) {
  const requireWallet = Boolean(options && options.requireWallet);

  return async function verifiedUserGuard(req, res, next) {
    if (!req.user) {
      return sendError(
        res,
        401,
        ERROR_CODES.UNAUTHORIZED,
        "Authentication is required."
      );
    }

    // 1. Phone must be verified
    if (!req.user.phoneVerified) {
      await recordUnverifiedAttempt(req, "PHONE");
      return sendError(
        res,
        403,
        ERROR_CODES.PHONE_NOT_VERIFIED,
        "Please verify your phone number before accessing this feature."
      );
    }

    // 2. Identity must be VERIFIED
    const isIdentityVerified =
      req.user.identityStatus === IDENTITY_STATUSES.VERIFIED;
    if (!isIdentityVerified) {
      await recordUnverifiedAttempt(req, "IDENTITY");
      return sendError(
        res,
        403,
        ERROR_CODES.IDENTITY_NOT_VERIFIED,
        "Please complete identity verification before accessing this feature."
      );
    }

    // 3. Optional wallet check (wallet linking itself is built in Prompt 9)
    if (
      requireWallet &&
      (!req.user.walletLinked || !req.user.walletAddress)
    ) {
      await recordUnverifiedAttempt(req, "WALLET");
      return sendError(
        res,
        403,
        ERROR_CODES.WALLET_NOT_LINKED,
        "Please link and verify your MetaMask wallet before accessing this feature."
      );
    }

    return next();
  };
}

function resetUnverifiedLogCache() {
  recentUnverifiedLogByKey.clear();
}

module.exports = {
  requireVerifiedUser,
  resetUnverifiedLogCache,
};
