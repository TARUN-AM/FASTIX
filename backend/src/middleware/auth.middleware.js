const User = require("../models/User.model");
const { ACCOUNT_STATUSES, ERROR_CODES } = require("../config/constants");
const { verifyAccessToken } = require("../utils/jwt");
const { sendError } = require("../utils/apiResponse");

/**
 * Verifies the Bearer JWT, loads the user document (without passwordHash or
 * identityHash), confirms the account is ACTIVE, and attaches req.user.
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
    } catch (_err) {
      return sendError(
        res,
        401,
        ERROR_CODES.UNAUTHORIZED,
        "Invalid or expired authentication token."
      );
    }

    const userId = decoded && (decoded.sub || decoded.userId || decoded.id);
    if (!userId) {
      return sendError(
        res,
        401,
        ERROR_CODES.UNAUTHORIZED,
        "Invalid authentication token payload."
      );
    }

    const user = await User.findById(userId);
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
        403,
        ERROR_CODES.FORBIDDEN,
        "This account has been suspended."
      );
    }

    req.user = user;
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  authenticate,
};
