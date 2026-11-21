const mongoose = require("mongoose");
const User = require("../models/User.model");
const { ACCOUNT_STATUSES, ERROR_CODES } = require("../config/constants");
const { verifyAccessToken } = require("../utils/jwt");
const { sendError } = require("../utils/apiResponse");

/**
 * Verifies the Bearer JWT, loads the user document from MongoDB (checking
 * lockedUntil and accountStatus against live DB state rather than trusting
 * stale token claims), and attaches req.user and req.auth.
 */
async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (typeof authHeader !== "string" || !authHeader.startsWith("Bearer ")) {
      return sendError(
        res,
        401,
        ERROR_CODES.UNAUTHORIZED,
        "Authentication token is required."
      );
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      return sendError(
        res,
        401,
        ERROR_CODES.UNAUTHORIZED,
        "Authentication token is required."
      );
    }

    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch (err) {
      return sendError(
        res,
        err.statusCode || 401,
        err.code || ERROR_CODES.UNAUTHORIZED,
        err.message || "Invalid or expired authentication token."
      );
    }

    const userId = decoded && decoded.sub;
    if (
      typeof userId !== "string" ||
      !mongoose.Types.ObjectId.isValid(userId)
    ) {
      return sendError(
        res,
        401,
        ERROR_CODES.UNAUTHORIZED,
        "Invalid authentication token payload."
      );
    }

    const user = await User.findById(userId).select("+lockedUntil");
    if (!user) {
      return sendError(
        res,
        401,
        ERROR_CODES.UNAUTHORIZED,
        "Account not found for this session."
      );
    }

    if (user.accountStatus === ACCOUNT_STATUSES.SUSPENDED) {
      return sendError(
        res,
        401,
        ERROR_CODES.UNAUTHORIZED,
        "This account is no longer active."
      );
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      return sendError(
        res,
        401,
        ERROR_CODES.UNAUTHORIZED,
        "This account is temporarily locked. Please sign in again later."
      );
    }

    // Clear selected lockout field before exposing user object downstream
    user.lockedUntil = undefined;

    req.user = user;
    // Always derive role from the database record, never from the JWT claim
    req.auth = {
      userId: String(user._id),
      role: user.role,
    };

    return next();
  } catch (err) {
    return next(err);
  }
}

/**
 * Optional authentication for public routes (e.g., GET /api/v1/events/:eventId).
 * If a valid Bearer JWT is present and maps to an active, unlocked user in MongoDB,
 * attaches req.user and req.auth. Otherwise silently continues as an unauthenticated
 * guest (never returns 401).
 */
async function optionalAuthenticate(req, _res, next) {
  try {
    req.user = null;
    req.auth = null;

    const authHeader = req.headers.authorization;
    if (typeof authHeader !== "string" || !authHeader.startsWith("Bearer ")) {
      return next();
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      return next();
    }

    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch (_err) {
      return next();
    }

    const userId = decoded && decoded.sub;
    if (
      typeof userId !== "string" ||
      !mongoose.Types.ObjectId.isValid(userId)
    ) {
      return next();
    }

    const user = await User.findById(userId).select("+lockedUntil");
    if (!user) {
      return next();
    }

    if (user.accountStatus === ACCOUNT_STATUSES.SUSPENDED) {
      return next();
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      return next();
    }

    user.lockedUntil = undefined;
    req.user = user;
    req.auth = {
      userId: String(user._id),
      role: user.role,
    };

    return next();
  } catch (_err) {
    // Unexpected optional-auth failure falls back to guest rather than leaking 500/401
    req.user = null;
    req.auth = null;
    return next();
  }
}

module.exports = {
  authenticate,
  optionalAuthenticate,
};
