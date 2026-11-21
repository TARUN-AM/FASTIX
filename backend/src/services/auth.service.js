const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const config = require("../config/env");
const {
  ACCOUNT_STATUSES,
  ERROR_CODES,
  SECURITY_EVENT_TYPES,
  SECURITY_SEVERITIES,
  USER_ROLES,
} = require("../config/constants");
const User = require("../models/User.model");
const SecurityLog = require("../models/SecurityLog.model");
const AppError = require("../utils/AppError");
const { signAccessToken } = require("../utils/jwt");
const { normalizeEmail } = require("../utils/normalize");
const { toPublicUser } = require("../utils/publicUser");

const BCRYPT_COST = 10;

// Pre-computed dummy bcrypt hash so unknown-email login attempts perform a real
// bcrypt verification and take approximately the same time as known-email failures.
const DUMMY_BCRYPT_HASH = bcrypt.hashSync(
  "fairticket_dummy_timing_pad_99",
  BCRYPT_COST
);

async function recordSecurityEvent({
  eventType,
  severity,
  userId,
  requestMeta = {},
  details = {},
}) {
  if (mongoose.connection.readyState !== 1) {
    return;
  }
  try {
    await SecurityLog.create({
      eventType,
      severity,
      userId,
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
      details,
    });
  } catch (_err) {
    // Security audit log failures must never crash auth responses
  }
}

async function register({ fullName, email, phone, password }) {
  const normalizedEmail = normalizeEmail(email);

  const existing = await User.findOne({
    $or: [{ email: normalizedEmail }, { phone }],
  })
    .select("_id")
    .lean();

  if (existing) {
    throw new AppError(
      409,
      ERROR_CODES.ALREADY_EXISTS,
      "An account with these details already exists."
    );
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  let user;
  try {
    user = await User.create({
      fullName,
      email: normalizedEmail,
      phone,
      passwordHash,
      // Self-registration ALWAYS creates a CUSTOMER account; staff roles are provisioned separately
      role: USER_ROLES.CUSTOMER,
    });
  } catch (err) {
    if (err && err.code === 11000) {
      throw new AppError(
        409,
        ERROR_CODES.ALREADY_EXISTS,
        "An account with these details already exists."
      );
    }
    throw err;
  }

  const token = signAccessToken(user);
  return {
    token,
    user: toPublicUser(user),
  };
}

async function login({ email, password }, requestMeta = {}) {
  const normalizedEmail = normalizeEmail(email);

  const user = await User.findOne({ email: normalizedEmail }).select(
    "+passwordHash +failedLoginCount +lockedUntil"
  );

  if (!user) {
    await bcrypt.compare(password, DUMMY_BCRYPT_HASH);
    await recordSecurityEvent({
      eventType: SECURITY_EVENT_TYPES.AUTH_LOGIN_FAILED,
      severity: SECURITY_SEVERITIES.LOW,
      requestMeta,
      details: { reason: "USER_NOT_FOUND" },
    });
    throw new AppError(
      401,
      ERROR_CODES.INVALID_CREDENTIALS,
      "Invalid email or password."
    );
  }

  if (user.accountStatus === ACCOUNT_STATUSES.SUSPENDED) {
    await bcrypt.compare(password, DUMMY_BCRYPT_HASH);
    await recordSecurityEvent({
      eventType: SECURITY_EVENT_TYPES.AUTH_LOGIN_FAILED,
      severity: SECURITY_SEVERITIES.MEDIUM,
      userId: user._id,
      requestMeta,
      details: { reason: "ACCOUNT_SUSPENDED" },
    });
    throw new AppError(
      401,
      ERROR_CODES.INVALID_CREDENTIALS,
      "Invalid email or password."
    );
  }

  const now = new Date();
  if (user.lockedUntil && user.lockedUntil > now) {
    await recordSecurityEvent({
      eventType: SECURITY_EVENT_TYPES.AUTH_LOGIN_FAILED,
      severity: SECURITY_SEVERITIES.MEDIUM,
      userId: user._id,
      requestMeta,
      details: { reason: "ACCOUNT_LOCKED_ATTEMPT" },
    });
    throw new AppError(
      423,
      ERROR_CODES.ACCOUNT_LOCKED,
      "Account temporarily locked. Please try again later."
    );
  }

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatches) {
    const updatedUser = await User.findByIdAndUpdate(
      user._id,
      { $inc: { failedLoginCount: 1 } },
      { new: true }
    ).select("+failedLoginCount +lockedUntil");

    const failedLoginCount = updatedUser
      ? updatedUser.failedLoginCount
      : (user.failedLoginCount || 0) + 1;

    if (failedLoginCount >= config.auth.maxFailedLogins) {
      const lockedUntil = new Date(
        Date.now() + config.auth.lockMinutes * 60 * 1000
      );
      await User.updateOne({ _id: user._id }, { $set: { lockedUntil } });

      await recordSecurityEvent({
        eventType: SECURITY_EVENT_TYPES.AUTH_ACCOUNT_LOCKED,
        severity: SECURITY_SEVERITIES.HIGH,
        userId: user._id,
        requestMeta,
        details: {
          failedLoginCount,
          lockMinutes: config.auth.lockMinutes,
        },
      });

      throw new AppError(
        423,
        ERROR_CODES.ACCOUNT_LOCKED,
        "Account temporarily locked. Please try again later."
      );
    }

    await recordSecurityEvent({
      eventType: SECURITY_EVENT_TYPES.AUTH_LOGIN_FAILED,
      severity: SECURITY_SEVERITIES.LOW,
      userId: user._id,
      requestMeta,
      details: {
        reason: "INVALID_PASSWORD",
        failedLoginCount,
      },
    });

    throw new AppError(
      401,
      ERROR_CODES.INVALID_CREDENTIALS,
      "Invalid email or password."
    );
  }

  // Successful login resets any accumulated failed attempts and clears expired locks
  await User.updateOne(
    { _id: user._id },
    { $set: { failedLoginCount: 0 }, $unset: { lockedUntil: 1 } }
  );

  const token = signAccessToken(user);
  return {
    token,
    user: toPublicUser(user),
  };
}

/**
 * Records a logout audit event.
 * Note: FairTicket access tokens are stateless JWTs held in client memory only,
 * so the client discards the token immediately on logout. Server-side token
 * revocation (e.g., short-lived refresh rotation / denylist) can be added when
 * deploying at scale.
 */
async function logout(user, requestMeta = {}) {
  await recordSecurityEvent({
    eventType: SECURITY_EVENT_TYPES.AUTH_LOGOUT,
    severity: SECURITY_SEVERITIES.LOW,
    userId: user._id || user.id,
    requestMeta,
    details: { role: user.role },
  });

  return { loggedOut: true };
}

module.exports = {
  register,
  login,
  logout,
};
