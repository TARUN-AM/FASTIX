const User = require("../models/User.model");
const VerificationRecord = require("../models/VerificationRecord.model");
const SecurityLog = require("../models/SecurityLog.model");
const config = require("../config/env");
const {
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
const { logSecurityEvent } = require("./securityLog.service");

const ROLLING_24H_MS = 24 * 60 * 60 * 1000;

const DUPLICATE_SOURCES = Object.freeze({
  PRE_CHECK: "PRE_CHECK",
  UNIQUE_INDEX: "UNIQUE_INDEX",
});

const DUPLICATE_ERROR_MESSAGE =
  "This identity is already linked to an account. Contact support if you think this is a mistake.";

// In-process guard reducing duplicate CRITICAL alerts during concurrent bursts.
const recentRepeatedAlertByUser = new Map();

/**
 * Looks up the owning user's ID for a given identityHash.
 * Overrides `select: false` only for matching and NEVER returns the hash itself.
 */
async function findIdentityOwner(identityHash) {
  if (typeof identityHash !== "string" || !identityHash) {
    return null;
  }

  const owner = await User.findOne({ identityHash })
    .select("_id +identityHash")
    .lean();

  return owner && owner._id ? String(owner._id) : null;
}

function getDuplicateFlagThreshold() {
  return config.identityDuplicateFlagThreshold;
}

/**
 * Single centralized path for handling every duplicate-identity collision,
 * whether caught early via PRE_CHECK or authoritatively via MongoDB UNIQUE_INDEX.
 *
 * PRIVACY:
 * - Never logs or returns identityHash, documentNumber, fullNameOnDocument, or providerReference.
 * - conflictingUserId is stored ONLY inside ADMIN-readable SecurityLogs and is NEVER returned to callers.
 */
async function handleDuplicateIdentity({
  attemptingUserId,
  conflictingUserId = null,
  identityHash = null,
  documentType = null,
  consentAt = null,
  source,
  requestMeta = {},
}) {
  const { ipAddress, userAgent } = requestMeta;
  const resolvedSource =
    source === DUPLICATE_SOURCES.UNIQUE_INDEX
      ? DUPLICATE_SOURCES.UNIQUE_INDEX
      : DUPLICATE_SOURCES.PRE_CHECK;

  let resolvedConflictingUserId = conflictingUserId
    ? String(conflictingUserId)
    : null;

  if (!resolvedConflictingUserId && identityHash) {
    const lookedUpOwner = await findIdentityOwner(identityHash);
    if (lookedUpOwner && lookedUpOwner !== String(attemptingUserId)) {
      resolvedConflictingUserId = lookedUpOwner;
    }
  }

  const logDetails = {
    conflictingUserId: resolvedConflictingUserId,
    source: resolvedSource,
  };
  if (!resolvedConflictingUserId) {
    logDetails.ownerLookupNote = "conflicting_owner_unavailable";
  }

  await logSecurityEvent({
    eventType: SECURITY_EVENT_TYPES.DUPLICATE_IDENTITY_ATTEMPT,
    severity: SECURITY_SEVERITIES.HIGH,
    userId: attemptingUserId,
    ipAddress,
    userAgent,
    details: logDetails,
  });

  // Update attempting user's VerificationRecord to REJECTED (DUPLICATE_IDENTITY), never storing identityHash.
  const now = consentAt instanceof Date ? consentAt : new Date();
  const recordUpdate = {
    status: VERIFICATION_STATUSES.REJECTED,
    identityStatus: IDENTITY_STATUSES.REJECTED,
    reasonCode: IDENTITY_REJECTION_REASONS.DUPLICATE_IDENTITY,
    rejectionReason: IDENTITY_REJECTION_REASONS.DUPLICATE_IDENTITY,
    consentAt: now,
    consentVersion: IDENTITY_CONSENT_VERSION,
  };
  if (documentType) {
    recordUpdate.documentType = documentType;
    recordUpdate.identityDocType = documentType;
  }

  await VerificationRecord.updateOne(
    {
      userId: attemptingUserId,
      verificationType: VERIFICATION_TYPES.MOCK_KYC,
      status: { $ne: VERIFICATION_STATUSES.VERIFIED },
    },
    {
      $set: recordUpdate,
      $unset: { identityHash: 1 },
    }
  );

  // Atomically mark attempting user as REJECTED only if not already VERIFIED.
  await User.updateOne(
    {
      _id: attemptingUserId,
      identityStatus: { $ne: IDENTITY_STATUSES.VERIFIED },
    },
    {
      $set: {
        identityStatus: IDENTITY_STATUSES.REJECTED,
      },
    }
  );

  // Escalate to a CRITICAL alert if duplicate attempts within 24h reach the configured threshold.
  const threshold = getDuplicateFlagThreshold();
  const windowStart = new Date(Date.now() - ROLLING_24H_MS);

  const recentDuplicateCount = await SecurityLog.countDocuments({
    userId: attemptingUserId,
    eventType: SECURITY_EVENT_TYPES.DUPLICATE_IDENTITY_ATTEMPT,
    createdAt: { $gte: windowStart },
  });

  if (recentDuplicateCount >= threshold) {
    const userKey = String(attemptingUserId);
    const nowMs = Date.now();
    const lastInMemAlertMs = recentRepeatedAlertByUser.get(userKey) || 0;

    if (nowMs - lastInMemAlertMs >= ROLLING_24H_MS) {
      const existingRepeatedAlert = await SecurityLog.exists({
        userId: attemptingUserId,
        eventType: SECURITY_EVENT_TYPES.DUPLICATE_IDENTITY_REPEATED,
        createdAt: { $gte: windowStart },
      });

      if (!existingRepeatedAlert) {
        recentRepeatedAlertByUser.set(userKey, nowMs);
        await logSecurityEvent({
          eventType: SECURITY_EVENT_TYPES.DUPLICATE_IDENTITY_REPEATED,
          severity: SECURITY_SEVERITIES.CRITICAL,
          userId: attemptingUserId,
          ipAddress,
          userAgent,
          details: {
            threshold,
            attemptCount24h: recentDuplicateCount,
            windowHours: 24,
            lastSource: resolvedSource,
          },
        });
      }
    }
  }

  throw new AppError(
    409,
    ERROR_CODES.IDENTITY_ALREADY_REGISTERED,
    DUPLICATE_ERROR_MESSAGE
  );
}

function resetRepeatedAlertCache() {
  recentRepeatedAlertByUser.clear();
}

module.exports = {
  DUPLICATE_SOURCES,
  DUPLICATE_ERROR_MESSAGE,
  findIdentityOwner,
  handleDuplicateIdentity,
  getDuplicateFlagThreshold,
  resetRepeatedAlertCache,
};
