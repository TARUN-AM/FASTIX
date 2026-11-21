const crypto = require("crypto");
const config = require("../config/env");
const {
  ERROR_CODES,
  SECURITY_EVENT_TYPES,
  SECURITY_SEVERITIES,
  USER_ROLES,
  VERIFICATION_STATUSES,
  VERIFICATION_TYPES,
} = require("../config/constants");
const User = require("../models/User.model");
const VerificationRecord = require("../models/VerificationRecord.model");
const AppError = require("../utils/AppError");
const { maskPhone } = require("../utils/normalize");
const { toPublicUser } = require("../utils/publicUser");
const { validateOtp } = require("../utils/validators");
const { logSecurityEvent } = require("./securityLog.service");
const smsProviderRegistry = require("./sms");
const identityService = require("./identity.service");

const OTP_KEY_DERIVATION_LABEL = "fairticket:otp:v1";
const ROLLING_HOUR_MS = 60 * 60 * 1000;

/**
 * Derives a dedicated HMAC key for OTP hashing from JWT_SECRET using a fixed
 * domain-separation label ("fairticket:otp:v1"). This avoids introducing an
 * extra secret environment variable while keeping OTP hashes cryptographically
 * separated from JWT signing keys.
 */
function deriveOtpHmacKey() {
  return crypto
    .createHmac("sha256", config.jwtSecret)
    .update(OTP_KEY_DERIVATION_LABEL)
    .digest();
}

/**
 * Generates a cryptographically secure numeric OTP of exactly `length` digits,
 * preserving leading zeros (never uses Math.random).
 */
function generateOtp(length = config.otp.length) {
  const maxExclusive = 10 ** length;
  const randomNumber = crypto.randomInt(0, maxExclusive);
  return String(randomNumber).padStart(length, "0");
}

/**
 * Computes a keyed HMAC-SHA256 hex digest binding the OTP to the specific
 * userId and phone number so an OTP hash cannot be reused across accounts.
 */
function hashOtp({ otp, userId, phone }) {
  return crypto
    .createHmac("sha256", deriveOtpHmacKey())
    .update(`otp:${String(userId)}:${String(phone)}:${String(otp)}`)
    .digest("hex");
}

/**
 * Constant-time string comparison using crypto.timingSafeEqual.
 * Checks byte lengths first so mismatched lengths safely return false without throwing.
 */
function safeCompareHash(hashA, hashB) {
  if (typeof hashA !== "string" || typeof hashB !== "string") {
    return false;
  }
  const bufA = Buffer.from(hashA, "utf8");
  const bufB = Buffer.from(hashB, "utf8");
  if (bufA.length !== bufB.length || bufA.length === 0) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function isDuplicateKeyError(err) {
  return Boolean(err && err.code === 11000);
}

/**
 * Atomically claims an OTP send slot for `userId`, enforcing both the resend
 * cooldown and the rolling 1-hour send cap via single-document conditional
 * updates (safe on standalone MongoDB without multi-document transactions).
 */
async function claimOtpSendSlot({
  userId,
  phone,
  otpHash,
  now,
  expiresAt,
  providerName,
}) {
  const cooldownCutoff = new Date(
    now.getTime() - config.otp.resendCooldownSeconds * 1000
  );
  const hourCutoff = new Date(now.getTime() - ROLLING_HOUR_MS);
  const maxSendsPerHour = config.otp.maxSendsPerHour;

  // Case 1: Existing record whose 1-hour window expired (or never started) AND outside cooldown
  const resetPrevDoc = await VerificationRecord.findOneAndUpdate(
    {
      userId,
      verificationType: VERIFICATION_TYPES.PHONE_OTP,
      $and: [
        {
          $or: [
            { otpLastSentAt: { $exists: false } },
            { otpLastSentAt: null },
            { otpLastSentAt: { $lte: cooldownCutoff } },
          ],
        },
        {
          $or: [
            { otpWindowStartedAt: { $exists: false } },
            { otpWindowStartedAt: null },
            { otpWindowStartedAt: { $lte: hourCutoff } },
          ],
        },
      ],
    },
    {
      $set: {
        phone,
        status: VERIFICATION_STATUSES.PENDING,
        otpHash,
        otpExpiresAt: expiresAt,
        otpAttemptCount: 0,
        otpSentCount: 1,
        otpWindowStartedAt: now,
        otpLastSentAt: now,
        otpConsumedAt: null,
        providerName,
      },
    },
    { new: false }
  ).select("+otpHash");

  if (resetPrevDoc) {
    return { claimed: true, wasCreated: false, previousDoc: resetPrevDoc };
  }

  // Case 2: Existing record within active 1-hour window, below send cap, AND outside cooldown
  const incPrevDoc = await VerificationRecord.findOneAndUpdate(
    {
      userId,
      verificationType: VERIFICATION_TYPES.PHONE_OTP,
      otpWindowStartedAt: { $gt: hourCutoff },
      otpSentCount: { $lt: maxSendsPerHour },
      $or: [
        { otpLastSentAt: { $exists: false } },
        { otpLastSentAt: null },
        { otpLastSentAt: { $lte: cooldownCutoff } },
      ],
    },
    {
      $inc: { otpSentCount: 1 },
      $set: {
        phone,
        status: VERIFICATION_STATUSES.PENDING,
        otpHash,
        otpExpiresAt: expiresAt,
        otpAttemptCount: 0,
        otpLastSentAt: now,
        otpConsumedAt: null,
        providerName,
      },
    },
    { new: false }
  ).select("+otpHash");

  if (incPrevDoc) {
    return { claimed: true, wasCreated: false, previousDoc: incPrevDoc };
  }

  // Case 3: No PHONE_OTP record exists yet for this user -> insert atomically
  // Protected by partial unique index { userId: 1, verificationType: 1 } for PHONE_OTP.
  const existing = await VerificationRecord.findOne({
    userId,
    verificationType: VERIFICATION_TYPES.PHONE_OTP,
  }).select("_id");

  if (!existing) {
    try {
      const created = await VerificationRecord.create({
        userId,
        verificationType: VERIFICATION_TYPES.PHONE_OTP,
        status: VERIFICATION_STATUSES.PENDING,
        phone,
        otpHash,
        otpExpiresAt: expiresAt,
        otpAttemptCount: 0,
        otpSentCount: 1,
        otpWindowStartedAt: now,
        otpLastSentAt: now,
        otpConsumedAt: null,
        providerName,
      });
      return { claimed: true, wasCreated: true, createdId: created._id };
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        // Another concurrent request created the record milliseconds earlier -> cooldown applies
        return { claimed: false };
      }
      throw err;
    }
  }

  return { claimed: false };
}

async function rollbackOtpSendSlot({
  wasCreated,
  createdId,
  previousDoc,
  sentAt,
}) {
  if (wasCreated && createdId) {
    await VerificationRecord.deleteOne({
      _id: createdId,
      otpLastSentAt: sentAt,
    });
    return;
  }

  if (previousDoc) {
    const restoreSet = {
      status: previousDoc.status,
      phone: previousDoc.phone,
      otpExpiresAt: previousDoc.otpExpiresAt || null,
      otpAttemptCount: previousDoc.otpAttemptCount || 0,
      otpSentCount: previousDoc.otpSentCount || 0,
      otpWindowStartedAt: previousDoc.otpWindowStartedAt || null,
      otpLastSentAt: previousDoc.otpLastSentAt || null,
      otpConsumedAt: previousDoc.otpConsumedAt || null,
    };
    const updateDoc = { $set: restoreSet };
    if (previousDoc.otpHash) {
      restoreSet.otpHash = previousDoc.otpHash;
    } else {
      updateDoc.$unset = { otpHash: 1 };
    }

    await VerificationRecord.updateOne(
      { _id: previousDoc._id, otpLastSentAt: sentAt },
      updateDoc
    );
  }
}

async function requestOtp(userId, requestMeta = {}) {
  const { ipAddress, userAgent } = requestMeta;

  const user = await User.findById(userId);
  if (!user) {
    throw new AppError(401, ERROR_CODES.UNAUTHORIZED, "Account not found.");
  }

  if (user.role !== USER_ROLES.CUSTOMER) {
    throw new AppError(
      403,
      ERROR_CODES.FORBIDDEN,
      "Only customer accounts can request phone verification codes."
    );
  }

  if (user.phoneVerified) {
    throw new AppError(
      409,
      ERROR_CODES.PHONE_ALREADY_VERIFIED,
      "Your phone number is already verified."
    );
  }

  const maskedPhone = maskPhone(user.phone);
  const otpLength = config.otp.length;
  const ttlSeconds = config.otp.ttlSeconds;
  const resendCooldownSeconds = config.otp.resendCooldownSeconds;
  const maxAttempts = config.otp.maxAttempts;

  const smsProvider = smsProviderRegistry.getSmsProvider();
  const otp = generateOtp(otpLength);
  const otpHash = hashOtp({ otp, userId: user._id, phone: user.phone });
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

  const slot = await claimOtpSendSlot({
    userId: user._id,
    phone: user.phone,
    otpHash,
    now,
    expiresAt,
    providerName: smsProvider.providerName || "SIMULATED_SMS",
  });

  if (!slot.claimed) {
    const current = await VerificationRecord.findOne({
      userId: user._id,
      verificationType: VERIFICATION_TYPES.PHONE_OTP,
    }).select("otpLastSentAt otpSentCount otpWindowStartedAt");

    const nowMs = Date.now();
    if (current && current.otpLastSentAt) {
      const cooldownEndsMs =
        new Date(current.otpLastSentAt).getTime() +
        resendCooldownSeconds * 1000;
      if (cooldownEndsMs > nowMs) {
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((cooldownEndsMs - nowMs) / 1000)
        );
        throw new AppError(
          429,
          ERROR_CODES.OTP_COOLDOWN,
          `Please wait ${retryAfterSeconds} seconds before requesting another code.`,
          { retryAfterSeconds }
        );
      }
    }

    await logSecurityEvent({
      eventType: SECURITY_EVENT_TYPES.OTP_SEND_LIMIT_HIT,
      severity: SECURITY_SEVERITIES.MEDIUM,
      userId: user._id,
      ipAddress,
      userAgent,
      details: { maskedPhone },
    });

    throw new AppError(
      429,
      ERROR_CODES.OTP_SEND_LIMIT,
      "You have reached the hourly limit for verification codes. Please try again later."
    );
  }

  try {
    await smsProvider.sendOtp({
      phone: user.phone,
      otp,
      expiresInSeconds: ttlSeconds,
    });
  } catch (_smsErr) {
    await rollbackOtpSendSlot({
      wasCreated: slot.wasCreated,
      createdId: slot.createdId,
      previousDoc: slot.previousDoc,
      sentAt: now,
    });
    throw new AppError(
      502,
      ERROR_CODES.SMS_FAILED,
      "Unable to deliver the verification code right now. Please try again."
    );
  }

  await logSecurityEvent({
    eventType: SECURITY_EVENT_TYPES.OTP_SENT,
    severity: SECURITY_SEVERITIES.LOW,
    userId: user._id,
    ipAddress,
    userAgent,
    details: {
      maskedPhone,
      expiresInSeconds: ttlSeconds,
    },
  });

  const payload = {
    maskedPhone,
    expiresAt: expiresAt.toISOString(),
    expiresInSeconds: ttlSeconds,
    resendAfterSeconds: resendCooldownSeconds,
    attemptsAllowed: maxAttempts,
  };

  if (config.otp.demoShowOtp && config.nodeEnv !== "production") {
    payload.demoOtp = otp;
  }

  return payload;
}

async function verifyOtp(userId, otpInput, requestMeta = {}) {
  const { ipAddress, userAgent } = requestMeta;

  const otpCheck = validateOtp(otpInput, config.otp.length);
  if (!otpCheck.valid) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, otpCheck.message, {
      otpCode: otpCheck.message,
    });
  }

  const user = await User.findById(userId);
  if (!user) {
    throw new AppError(401, ERROR_CODES.UNAUTHORIZED, "Account not found.");
  }

  if (user.role !== USER_ROLES.CUSTOMER) {
    throw new AppError(
      403,
      ERROR_CODES.FORBIDDEN,
      "Only customer accounts can verify a phone number."
    );
  }

  if (user.phoneVerified) {
    throw new AppError(
      409,
      ERROR_CODES.PHONE_ALREADY_VERIFIED,
      "Your phone number is already verified."
    );
  }

  const maskedPhone = maskPhone(user.phone);
  const now = new Date();
  const maxAttempts = config.otp.maxAttempts;

  // Atomically reserve one verification attempt on an active, non-consumed, non-expired OTP
  const record = await VerificationRecord.findOneAndUpdate(
    {
      userId: user._id,
      verificationType: VERIFICATION_TYPES.PHONE_OTP,
      otpHash: { $type: "string" },
      otpConsumedAt: null,
      otpExpiresAt: { $gt: now },
      otpAttemptCount: { $lt: maxAttempts },
    },
    { $inc: { otpAttemptCount: 1 } },
    { new: true }
  ).select("+otpHash");

  if (!record) {
    const existing = await VerificationRecord.findOne({
      userId: user._id,
      verificationType: VERIFICATION_TYPES.PHONE_OTP,
    }).select("+otpHash");

    if (!existing || (!existing.otpHash && !existing.otpConsumedAt)) {
      throw new AppError(
        400,
        ERROR_CODES.OTP_NOT_REQUESTED,
        "No verification code has been requested yet. Please send a code first."
      );
    }

    if (existing.otpConsumedAt) {
      throw new AppError(
        400,
        ERROR_CODES.OTP_INVALID,
        "This verification code has already been used. Please request a new code."
      );
    }

    if (existing.otpExpiresAt && existing.otpExpiresAt <= now) {
      throw new AppError(
        400,
        ERROR_CODES.OTP_EXPIRED,
        "Your verification code has expired. Please request a new code."
      );
    }

    if (existing.otpAttemptCount >= maxAttempts) {
      throw new AppError(
        429,
        ERROR_CODES.OTP_MAX_ATTEMPTS,
        "Too many incorrect attempts. Please request a new verification code.",
        { attemptsRemaining: 0 }
      );
    }

    throw new AppError(
      400,
      ERROR_CODES.OTP_NOT_REQUESTED,
      "No active verification code found. Please request a new code."
    );
  }

  const candidateHash = hashOtp({
    otp: otpCheck.value,
    userId: user._id,
    phone: user.phone,
  });

  if (!safeCompareHash(record.otpHash, candidateHash)) {
    const attemptsRemaining = Math.max(0, maxAttempts - record.otpAttemptCount);

    if (record.otpAttemptCount >= maxAttempts) {
      await logSecurityEvent({
        eventType: SECURITY_EVENT_TYPES.OTP_BRUTE_FORCE,
        severity: SECURITY_SEVERITIES.HIGH,
        userId: user._id,
        ipAddress,
        userAgent,
        details: {
          maskedPhone,
          attemptCount: record.otpAttemptCount,
        },
      });

      throw new AppError(
        429,
        ERROR_CODES.OTP_MAX_ATTEMPTS,
        "Too many incorrect attempts. Please request a new verification code.",
        { attemptsRemaining: 0 }
      );
    }

    await logSecurityEvent({
      eventType: SECURITY_EVENT_TYPES.OTP_FAILED,
      severity: SECURITY_SEVERITIES.LOW,
      userId: user._id,
      ipAddress,
      userAgent,
      details: {
        maskedPhone,
        attemptsRemaining,
      },
    });

    throw new AppError(
      400,
      ERROR_CODES.OTP_INVALID,
      `Incorrect verification code. ${attemptsRemaining} ${
        attemptsRemaining === 1 ? "attempt" : "attempts"
      } remaining.`,
      { attemptsRemaining }
    );
  }

  // Atomically mark the OTP consumed and clear otpHash so concurrent requests
  // presenting the same correct code can never verify twice.
  const consumed = await VerificationRecord.findOneAndUpdate(
    {
      _id: record._id,
      otpConsumedAt: null,
      otpExpiresAt: { $gt: now },
      otpHash: record.otpHash,
    },
    {
      $set: {
        status: VERIFICATION_STATUSES.VERIFIED,
        otpConsumedAt: now,
        verifiedAt: now,
      },
      $unset: {
        otpHash: 1,
      },
    },
    { new: true }
  );

  if (!consumed) {
    throw new AppError(
      400,
      ERROR_CODES.OTP_INVALID,
      "This verification code has already been used."
    );
  }

  const updatedUser = await User.findByIdAndUpdate(
    user._id,
    { $set: { phoneVerified: true } },
    { new: true }
  );

  await logSecurityEvent({
    eventType: SECURITY_EVENT_TYPES.OTP_VERIFIED,
    severity: SECURITY_SEVERITIES.LOW,
    userId: user._id,
    ipAddress,
    userAgent,
    details: { maskedPhone },
  });

  return {
    phoneVerified: true,
    user: toPublicUser(updatedUser),
  };
}

async function getVerificationStatus(userId) {
  return identityService.getVerificationStatus(userId);
}

module.exports = {
  generateOtp,
  hashOtp,
  safeCompareHash,
  maskPhone,
  requestOtp,
  verifyOtp,
  getVerificationStatus,
};
