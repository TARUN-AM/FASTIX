const User = require("../models/User.model");
const VerificationRecord = require("../models/VerificationRecord.model");
const config = require("../config/env");
const {
  USER_ROLES,
  VERIFICATION_TYPES,
  VERIFICATION_STATUSES,
  IDENTITY_STATUSES,
  IDENTITY_CONSENT_VERSION,
  IDENTITY_REJECTION_REASONS,
  SECURITY_EVENT_TYPES,
  SECURITY_SEVERITIES,
  ERROR_CODES,
} = require("../config/constants");
const AppError = require("../utils/AppError");
const { computeIdentityHash } = require("../utils/identityHash");
const { toPublicUser } = require("../utils/publicUser");
const identityProviderRegistry = require("./identity");
const { logSecurityEvent } = require("./securityLog.service");

const ROLLING_WINDOW_MS = 24 * 60 * 60 * 1000;

function isDuplicateKeyError(err, fieldName) {
  if (!err || err.code !== 11000) {
    return false;
  }
  if (!fieldName) {
    return true;
  }
  if (err.keyPattern && Object.prototype.hasOwnProperty.call(err.keyPattern, fieldName)) {
    return true;
  }
  return String(err.message || "").includes(fieldName);
}

/**
 * Atomically claims one attempt slot in the user's rolling 24-hour window using
 * filter conditions inside findOneAndUpdate so concurrent submissions cannot
 * exceed IDENTITY_MAX_ATTEMPTS_PER_DAY.
 */
async function claimDailyAttemptSlot(userId, documentType, now) {
  const maxAttempts = config.identityMaxAttemptsPerDay;
  const windowCutoff = new Date(now.getTime() - ROLLING_WINDOW_MS);

  // Case 1: Existing record whose rolling 24-hour window has expired or was never started
  let record = await VerificationRecord.findOneAndUpdate(
    {
      userId,
      verificationType: VERIFICATION_TYPES.MOCK_KYC,
      $or: [
        { attemptWindowStartedAt: { $exists: false } },
        { attemptWindowStartedAt: null },
        { attemptWindowStartedAt: { $lte: windowCutoff } },
      ],
    },
    {
      $set: {
        attemptCount: 1,
        attemptWindowStartedAt: now,
        documentType,
        identityDocType: documentType,
      },
    },
    { new: true }
  );

  if (record) {
    return record;
  }

  // Case 2: Existing record within active 24-hour window with remaining attempts
  record = await VerificationRecord.findOneAndUpdate(
    {
      userId,
      verificationType: VERIFICATION_TYPES.MOCK_KYC,
      attemptWindowStartedAt: { $gt: windowCutoff },
      attemptCount: { $lt: maxAttempts },
    },
    {
      $inc: { attemptCount: 1 },
      $set: {
        documentType,
        identityDocType: documentType,
      },
    },
    { new: true }
  );

  if (record) {
    return record;
  }

  // Case 3: No MOCK_KYC record exists yet for this user -> create atomically
  const existing = await VerificationRecord.findOne({
    userId,
    verificationType: VERIFICATION_TYPES.MOCK_KYC,
  }).select("_id");

  if (!existing) {
    try {
      return await VerificationRecord.create({
        userId,
        verificationType: VERIFICATION_TYPES.MOCK_KYC,
        status: VERIFICATION_STATUSES.PENDING,
        identityStatus: IDENTITY_STATUSES.NOT_STARTED,
        documentType,
        identityDocType: documentType,
        attemptCount: 1,
        attemptWindowStartedAt: now,
      });
    } catch (err) {
      // A concurrent request inserted the initial record first; retry Case 2 atomically
      if (isDuplicateKeyError(err)) {
        return VerificationRecord.findOneAndUpdate(
          {
            userId,
            verificationType: VERIFICATION_TYPES.MOCK_KYC,
            attemptWindowStartedAt: { $gt: windowCutoff },
            attemptCount: { $lt: maxAttempts },
          },
          {
            $inc: { attemptCount: 1 },
            $set: {
              documentType,
              identityDocType: documentType,
            },
          },
          { new: true }
        );
      }
      throw err;
    }
  }

  return null;
}

async function restoreAttemptSlot(recordId) {
  if (!recordId) {
    return;
  }
  await VerificationRecord.updateOne(
    { _id: recordId, attemptCount: { $gt: 0 } },
    { $inc: { attemptCount: -1 } }
  );
}

/**
 * Processes a simulated identity verification submission for a verified-phone CUSTOMER.
 * Raw documentNumber and fullNameOnDocument remain strictly in memory for this request
 * and are never written to MongoDB, SecurityLog, logs, or responses.
 */
async function submitIdentity(
  userId,
  { documentType, documentNumber, fullNameOnDocument, consent },
  requestMeta = {}
) {
  const { ipAddress, userAgent } = requestMeta;

  if (consent !== true) {
    throw new AppError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      "Consent is required before submitting identity verification."
    );
  }

  const user = await User.findById(userId);
  if (!user) {
    throw new AppError(401, ERROR_CODES.UNAUTHORIZED, "Account not found.");
  }

  if (user.role !== USER_ROLES.CUSTOMER) {
    throw new AppError(
      403,
      ERROR_CODES.FORBIDDEN,
      "Only customer accounts can submit identity verification."
    );
  }

  if (!user.phoneVerified) {
    throw new AppError(
      403,
      ERROR_CODES.PHONE_NOT_VERIFIED,
      "Please verify your phone number before verifying your identity."
    );
  }

  if (user.identityStatus === IDENTITY_STATUSES.VERIFIED || user.identityVerified) {
    throw new AppError(
      409,
      ERROR_CODES.IDENTITY_ALREADY_VERIFIED,
      "Your identity is already verified."
    );
  }

  await logSecurityEvent({
    eventType: SECURITY_EVENT_TYPES.IDENTITY_SUBMITTED,
    severity: SECURITY_SEVERITIES.LOW,
    userId: user._id,
    ipAddress,
    userAgent,
    details: { documentType },
  });

  const now = new Date();
  const attemptRecord = await claimDailyAttemptSlot(user._id, documentType, now);

  if (!attemptRecord) {
    await logSecurityEvent({
      eventType: SECURITY_EVENT_TYPES.IDENTITY_ATTEMPT_LIMIT,
      severity: SECURITY_SEVERITIES.MEDIUM,
      userId: user._id,
      ipAddress,
      userAgent,
      details: { documentType },
    });

    throw new AppError(
      429,
      ERROR_CODES.IDENTITY_ATTEMPT_LIMIT,
      "You have reached the daily limit for identity verification attempts. Please try again later."
    );
  }

  let providerResult;
  try {
    const provider = identityProviderRegistry.getIdentityProvider();
    providerResult = await provider.verify({
      documentType,
      documentNumber,
      fullNameOnDocument,
      accountName: user.fullName,
    });
  } catch (_providerError) {
    await restoreAttemptSlot(attemptRecord._id);
    throw new AppError(
      502,
      ERROR_CODES.IDENTITY_PROVIDER_FAILED,
      "Identity verification service is temporarily unavailable. Please try again."
    );
  }

  if (providerResult.status === IDENTITY_STATUSES.REJECTED) {
    const reasonCode = providerResult.reasonCode || IDENTITY_REJECTION_REASONS.DOCUMENT_REJECTED;

    await VerificationRecord.updateOne(
      { _id: attemptRecord._id, status: { $ne: VERIFICATION_STATUSES.VERIFIED } },
      {
        $set: {
          status: VERIFICATION_STATUSES.REJECTED,
          identityStatus: IDENTITY_STATUSES.REJECTED,
          reasonCode,
          rejectionReason: reasonCode,
          providerName: providerResult.providerName,
          providerReference: providerResult.providerReference,
          documentType,
          identityDocType: documentType,
          consentAt: now,
          consentVersion: IDENTITY_CONSENT_VERSION,
        },
        $unset: { identityHash: 1 },
      }
    );

    await User.updateOne(
      {
        _id: user._id,
        identityStatus: { $ne: IDENTITY_STATUSES.VERIFIED },
      },
      {
        $set: {
          identityStatus: IDENTITY_STATUSES.REJECTED,
        },
      }
    );

    await logSecurityEvent({
      eventType: SECURITY_EVENT_TYPES.IDENTITY_REJECTED,
      severity: SECURITY_SEVERITIES.LOW,
      userId: user._id,
      ipAddress,
      userAgent,
      details: {
        documentType,
        reasonCode,
      },
    });

    const friendlyMessage =
      reasonCode === IDENTITY_REJECTION_REASONS.NAME_MISMATCH
        ? "The name on the document does not match your FairTicket account name. Please check and try again."
        : "This demo document was rejected by the verification check. Please check your details and try again.";

    throw new AppError(422, ERROR_CODES.IDENTITY_REJECTED, friendlyMessage, {
      reasonCode,
    });
  }

  const identityHash = computeIdentityHash({
    documentType,
    documentNumber,
  });

  const verifiedAt = new Date();
  let updatedUser;

  // Full duplicate-identity handling (pre-check, security alerts, race-condition tests) is built in Prompt 8.
  try {
    updatedUser = await User.findOneAndUpdate(
      {
        _id: user._id,
        phoneVerified: true,
        identityStatus: { $ne: IDENTITY_STATUSES.VERIFIED },
      },
      {
        $set: {
          identityStatus: IDENTITY_STATUSES.VERIFIED,
          identityVerified: true,
          identityVerifiedAt: verifiedAt,
          identityHash,
        },
      },
      { new: true }
    );
  } catch (err) {
    if (isDuplicateKeyError(err, "identityHash")) {
      await logSecurityEvent({
        eventType: SECURITY_EVENT_TYPES.IDENTITY_ALREADY_REGISTERED,
        severity: SECURITY_SEVERITIES.HIGH,
        userId: user._id,
        ipAddress,
        userAgent,
        details: { documentType },
      });

      throw new AppError(
        409,
        ERROR_CODES.IDENTITY_ALREADY_REGISTERED,
        "This identity is already linked to an account. Contact support if you think this is a mistake."
      );
    }
    throw err;
  }

  if (!updatedUser) {
    throw new AppError(
      409,
      ERROR_CODES.IDENTITY_ALREADY_VERIFIED,
      "Your identity is already verified."
    );
  }

  await VerificationRecord.findOneAndUpdate(
    {
      userId: user._id,
      verificationType: VERIFICATION_TYPES.MOCK_KYC,
    },
    {
      $set: {
        status: VERIFICATION_STATUSES.VERIFIED,
        identityStatus: IDENTITY_STATUSES.VERIFIED,
        reasonCode: null,
        rejectionReason: null,
        providerName: providerResult.providerName,
        providerReference: providerResult.providerReference,
        documentType,
        identityDocType: documentType,
        consentAt: verifiedAt,
        consentVersion: IDENTITY_CONSENT_VERSION,
        verifiedAt,
        identityHash,
      },
    },
    { upsert: true, new: true }
  );

  await logSecurityEvent({
    eventType: SECURITY_EVENT_TYPES.IDENTITY_VERIFIED,
    severity: SECURITY_SEVERITIES.LOW,
    userId: user._id,
    ipAddress,
    userAgent,
    details: { documentType },
  });

  return {
    identityStatus: IDENTITY_STATUSES.VERIFIED,
    verifiedAt: verifiedAt.toISOString(),
  };
}

/**
 * Returns safe verification status for the authenticated user.
 * Never returns identityHash, providerReference, or raw document data.
 */
async function getVerificationStatus(userId) {
  const user = await User.findById(userId);
  if (!user) {
    throw new AppError(401, ERROR_CODES.UNAUTHORIZED, "Account not found.");
  }

  const identityRecord = await VerificationRecord.findOne({
    userId: user._id,
    verificationType: VERIFICATION_TYPES.MOCK_KYC,
  }).select("attemptCount attemptWindowStartedAt reasonCode");

  const maxAttempts = config.identityMaxAttemptsPerDay;
  const nowMs = Date.now();
  let usedAttempts = 0;

  if (
    identityRecord &&
    identityRecord.attemptWindowStartedAt &&
    nowMs - new Date(identityRecord.attemptWindowStartedAt).getTime() <
      ROLLING_WINDOW_MS
  ) {
    usedAttempts = Number.isInteger(identityRecord.attemptCount)
      ? identityRecord.attemptCount
      : 0;
  }

  const attemptsRemaining = Math.max(0, maxAttempts - usedAttempts);
  const identityStatus =
    user.identityStatus ||
    (user.identityVerified
      ? IDENTITY_STATUSES.VERIFIED
      : IDENTITY_STATUSES.NOT_STARTED);

  return {
    phoneVerified: Boolean(user.phoneVerified),
    identityVerified: identityStatus === IDENTITY_STATUSES.VERIFIED,
    walletLinked: Boolean(user.walletLinked),
    walletAddress: user.walletAddress || null,
    phone: {
      verified: Boolean(user.phoneVerified),
    },
    identity: {
      status: identityStatus,
      verifiedAt: user.identityVerifiedAt
        ? user.identityVerifiedAt.toISOString()
        : null,
      attemptsRemaining,
      reasonCode:
        identityStatus === IDENTITY_STATUSES.REJECTED && identityRecord?.reasonCode
          ? identityRecord.reasonCode
          : null,
    },
    wallet: {
      linked: Boolean(user.walletLinked),
      address: user.walletAddress || null,
    },
    user: toPublicUser(user),
  };
}

module.exports = {
  submitIdentity,
  getVerificationStatus,
};
