const jwt = require("jsonwebtoken");
const config = require("../config/env");
const { ERROR_CODES } = require("../config/constants");
const AppError = require("./AppError");

function signAccessToken(user) {
  const payload = {
    sub: String(user._id || user.id),
    role: user.role,
  };
  return jwt.sign(payload, config.jwtSecret, {
    algorithm: "HS256",
    expiresIn: config.jwtExpiresIn,
    issuer: config.jwtIssuer,
    audience: config.jwtAudience,
  });
}

function verifyAccessToken(token) {
  if (typeof token !== "string" || token.trim().length === 0) {
    throw new AppError(
      401,
      ERROR_CODES.UNAUTHORIZED,
      "Invalid authentication token."
    );
  }

  try {
    return jwt.verify(token, config.jwtSecret, {
      algorithms: ["HS256"],
      issuer: config.jwtIssuer,
      audience: config.jwtAudience,
    });
  } catch (err) {
    if (err && err.name === "TokenExpiredError") {
      throw new AppError(
        401,
        ERROR_CODES.TOKEN_EXPIRED,
        "Your session has expired. Please sign in again."
      );
    }
    throw new AppError(
      401,
      ERROR_CODES.UNAUTHORIZED,
      "Invalid authentication token."
    );
  }
}

module.exports = {
  signAccessToken,
  verifyAccessToken,
};
