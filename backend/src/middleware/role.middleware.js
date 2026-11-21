const mongoose = require("mongoose");
const SecurityLog = require("../models/SecurityLog.model");
const {
  ERROR_CODES,
  SECURITY_EVENT_TYPES,
  SECURITY_SEVERITIES,
} = require("../config/constants");
const { sendError } = require("../utils/apiResponse");

/**
 * Role-based access control middleware accepting either rest arguments
 * (`requireRole("CUSTOMER", "ADMIN")`) or an array (`requireRole(["CUSTOMER"])`).
 * Reads role from req.auth / req.user (populated from MongoDB by `authenticate`).
 */
function requireRole(...allowedRolesInput) {
  const allowedRoles = allowedRolesInput.flat();

  return async function roleGuard(req, res, next) {
    if (!req.user) {
      return sendError(
        res,
        401,
        ERROR_CODES.UNAUTHORIZED,
        "Authentication is required."
      );
    }

    const actualRole = (req.auth && req.auth.role) || req.user.role;
    if (!allowedRoles.includes(actualRole)) {
      if (mongoose.connection.readyState === 1) {
        try {
          const userAgentHeader =
            typeof req.headers["user-agent"] === "string"
              ? req.headers["user-agent"].slice(0, 200)
              : undefined;

          await SecurityLog.create({
            eventType: SECURITY_EVENT_TYPES.UNAUTHORIZED_ACCESS,
            severity: SECURITY_SEVERITIES.MEDIUM,
            userId: req.user._id || req.user.id,
            ipAddress: req.ip || req.socket?.remoteAddress || undefined,
            userAgent: userAgentHeader,
            details: {
              requiredRoles: allowedRoles,
              actualRole,
              method: req.method,
              path: req.originalUrl || req.path,
            },
          });
        } catch (_logErr) {
          // Never block the 403 response if audit logging fails
        }
      }

      return sendError(
        res,
        403,
        ERROR_CODES.FORBIDDEN,
        "You do not have permission to perform this action."
      );
    }

    return next();
  };
}

module.exports = {
  requireRole,
};
