const rateLimit = require("express-rate-limit");
const config = require("../config/env");
const { ERROR_CODES } = require("../config/constants");

function buildRateLimitHandler(message) {
  return (_req, res) => {
    res.status(429).json({
      success: false,
      data: null,
      error: {
        code: ERROR_CODES.RATE_LIMITED,
        message,
      },
    });
  };
}

const globalRateLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  handler: buildRateLimitHandler(
    "Too many requests from this IP. Please try again later."
  ),
});

/**
 * Factory for the identity submission rate limiter.
 * Defaults to IDENTITY_SUBMIT_RATE_LIMIT_MAX requests per 60 minutes keyed by IP + userId.
 * Accepts option overrides for isolated tests.
 */
function createIdentitySubmitLimiter(overrides = {}) {
  return rateLimit({
    windowMs: 60 * 60 * 1000,
    max: config.identitySubmitRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const ip = req.ip || req.socket?.remoteAddress || "unknown";
      const userId = req.user ? String(req.user._id || req.user.id) : "anon";
      return `${ip}:${userId}`;
    },
    handler: buildRateLimitHandler(
      "Too many identity verification requests. Please wait before trying again."
    ),
    ...overrides,
  });
}

module.exports = {
  globalRateLimiter,
  createIdentitySubmitLimiter,
};
