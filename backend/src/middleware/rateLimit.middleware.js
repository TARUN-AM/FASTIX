const rateLimit = require("express-rate-limit");
const config = require("../config/env");
const { ERROR_CODES } = require("../config/constants");
const { normalizeEmail } = require("../utils/normalize");

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

/**
 * Factory for the login rate limiter.
 * Defaults to AUTH_LOGIN_RATE_LIMIT_MAX requests per 15 minutes keyed by IP + normalized email.
 */
function createLoginLimiter(overrides = {}) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: config.auth.loginRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const ip = req.ip || req.socket?.remoteAddress || "unknown";
      const email =
        req.body && typeof req.body.email === "string"
          ? normalizeEmail(req.body.email)
          : "";
      return `${ip}:${email}`;
    },
    handler: buildRateLimitHandler(
      "Too many sign-in attempts. Please wait a few minutes and try again."
    ),
    ...overrides,
  });
}

/**
 * Factory for the registration rate limiter.
 * Defaults to AUTH_REGISTER_RATE_LIMIT_MAX requests per 60 minutes keyed by IP.
 */
function createRegisterLimiter(overrides = {}) {
  return rateLimit({
    windowMs: 60 * 60 * 1000,
    max: config.auth.registerRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.ip || req.socket?.remoteAddress || "unknown",
    handler: buildRateLimitHandler(
      "Too many account creation attempts from this network. Please try again later."
    ),
    ...overrides,
  });
}

/**
 * Factory for the OTP send rate limiter.
 * Defaults to OTP_SEND_RATE_LIMIT_MAX requests per 60 minutes keyed by IP + userId.
 */
function createOtpSendLimiter(overrides = {}) {
  return rateLimit({
    windowMs: 60 * 60 * 1000,
    max: config.otp.sendRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const ip = req.ip || req.socket?.remoteAddress || "unknown";
      const userId = req.user ? String(req.user._id || req.user.id) : "anon";
      return `${ip}:${userId}`;
    },
    handler: buildRateLimitHandler(
      "Too many OTP requests. Please wait before requesting another code."
    ),
    ...overrides,
  });
}

/**
 * Factory for the OTP verify rate limiter.
 * Defaults to OTP_VERIFY_RATE_LIMIT_MAX requests per 15 minutes keyed by IP + userId.
 */
function createOtpVerifyLimiter(overrides = {}) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: config.otp.verifyRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const ip = req.ip || req.socket?.remoteAddress || "unknown";
      const userId = req.user ? String(req.user._id || req.user.id) : "anon";
      return `${ip}:${userId}`;
    },
    handler: buildRateLimitHandler(
      "Too many verification attempts. Please wait a few minutes and try again."
    ),
    ...overrides,
  });
}

/**
 * Factory for the wallet challenge rate limiter.
 * Defaults to WALLET_CHALLENGE_RATE_LIMIT_MAX requests per 60 minutes keyed by IP + userId.
 */
function createWalletChallengeLimiter(overrides = {}) {
  return rateLimit({
    windowMs: 60 * 60 * 1000,
    max: config.wallet.challengeRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const ip = req.ip || req.socket?.remoteAddress || "unknown";
      const userId = req.user ? String(req.user._id || req.user.id) : "anon";
      return `${ip}:${userId}`;
    },
    handler: buildRateLimitHandler(
      "Too many wallet challenge requests. Please wait before trying again."
    ),
    ...overrides,
  });
}

/**
 * Factory for the wallet signature verification rate limiter.
 * Defaults to WALLET_VERIFY_RATE_LIMIT_MAX requests per 15 minutes keyed by IP + userId.
 */
function createWalletVerifyLimiter(overrides = {}) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: config.wallet.verifyRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const ip = req.ip || req.socket?.remoteAddress || "unknown";
      const userId = req.user ? String(req.user._id || req.user.id) : "anon";
      return `${ip}:${userId}`;
    },
    handler: buildRateLimitHandler(
      "Too many wallet verification attempts. Please wait a few minutes and try again."
    ),
    ...overrides,
  });
}

/**
 * Factory for the event write rate limiter (create, edit, publish, cancel).
 * Defaults to EVENT_WRITE_RATE_LIMIT_MAX requests per 60 minutes keyed by userId.
 */
function createEventWriteLimiter(overrides = {}) {
  return rateLimit({
    windowMs: 60 * 60 * 1000,
    max: config.events.writeRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      if (req.user) {
        return String(req.user._id || req.user.id);
      }
      return req.ip || req.socket?.remoteAddress || "unknown";
    },
    handler: buildRateLimitHandler(
      "Too many event update requests. Please wait before trying again."
    ),
    ...overrides,
  });
}

/**
 * Factory for the public event listing/read rate limiter.
 * Defaults to EVENT_READ_RATE_LIMIT_MAX requests per 15 minutes keyed by IP.
 */
function createEventReadLimiter(overrides = {}) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: config.events.readRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.ip || req.socket?.remoteAddress || "unknown",
    handler: buildRateLimitHandler(
      "Too many event browse requests from this network. Please try again shortly."
    ),
    ...overrides,
  });
}

module.exports = {
  globalRateLimiter,
  createIdentitySubmitLimiter,
  createLoginLimiter,
  createRegisterLimiter,
  createOtpSendLimiter,
  createOtpVerifyLimiter,
  createWalletChallengeLimiter,
  createWalletVerifyLimiter,
  createEventWriteLimiter,
  createEventReadLimiter,
};
