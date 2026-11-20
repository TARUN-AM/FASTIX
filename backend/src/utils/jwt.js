const jwt = require("jsonwebtoken");
const config = require("../config/env");

function signAccessToken(user) {
  const payload = {
    sub: String(user._id || user.id),
    role: user.role,
  };
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

function verifyAccessToken(token) {
  return jwt.verify(token, config.jwtSecret);
}

module.exports = {
  signAccessToken,
  verifyAccessToken,
};
