const { ERROR_CODES } = require("../config/constants");
const { sendError } = require("../utils/apiResponse");

/**
 * Role-based access control middleware accepting either rest arguments
 * (`requireRole("CUSTOMER", "ADMIN")`) or an array (`requireRole(["CUSTOMER"])`).
 */
function requireRole(...allowedRolesInput) {
  const allowedRoles = allowedRolesInput.flat();

  return function roleGuard(req, res, next) {
    if (!req.user) {
      return sendError(
        res,
        401,
        ERROR_CODES.UNAUTHORIZED,
        "Authentication is required."
      );
    }

    if (!allowedRoles.includes(req.user.role)) {
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
