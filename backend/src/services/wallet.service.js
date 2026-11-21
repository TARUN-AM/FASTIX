const crypto = require("crypto");
const { ethers } = require("ethers");
const User = require("../models/User.model");
const VerificationRecord = require("../models/VerificationRecord.model");
const config = require("../config/env");
const {
  USER_ROLES,
  VERIFICATION_TYPES,
  VERIFICATION_STATUSES,
  IDENTITY_STATUSES,
  SECURITY_EVENT_TYPES,
  SECURITY_SEVERITIES,
  ERROR_CODES,
} = require("../config/constants");
const AppError = require("../utils/AppError");
const { maskAddress } = require("../utils/maskAddress");
const {
  validateWalletAddress,
  validateSignature,
} = require("../utils/validators");
const { buildChallengeMessage } = require("./wallet/challengeMessage");
const { logSecurityEvent } = require("./securityLog.service");

const ROLLING_HOUR_MS = 60 * 60 * 1000;
const CHALLENGE_SELECT_FIELDS =
  "+walletChallengeNonce +walletChallengeAddress +walletChallengeChainId +walletChallengeIssuedAt +walletChallengeExpiresAt +walletChallengeConsumedAt +walletChallengeAttempts +walletChallengeCount +walletChallengeWindowStartedAt";

/**
 * NOTE: This service links a MetaMask wallet to a verified CUSTOMER account
 * in MongoDB only (off-chain cryptographic ownership proof via EIP-191 personal_sign).
 * On-chain wallet verification (FairTicket.verifyWallet) is built in Prompts 15-17.
 */

function isDuplicateKeyError(err, fieldName) {
  if (!err || err.code !== 11000) {
    return false;
  }
  if (!fieldName) {
    return true;
  }
  if (
    err.keyPattern &&
    Object.prototype.hasOwnProperty.call(err.keyPattern, fieldName)
  ) {
    return true;
  }
  return String(err.message || "").includes(fieldName);
}

/**
 * Atomically claims a rolling 1-hour wallet challenge slot and replaces any
 * previous unconsumed challenge on the user's WALLET_PROOF VerificationRecord.
 * Returns the updated VerificationRecord or null if the hourly limit is reached.
 */
async function claimChallengeSlot(userId, challengeFields, now) {
  const maxPerHour = config.wallet.challengeMaxPerHour;
  const windowCutoff = new Date(now.getTime() - ROLLING_HOUR_MS);

  // Case 1: Existing record whose rolling 1-hour window has expired or was never started
  let record = await VerificationRecord.findOneAndUpdate(
    {
      userId,
      verificationType: VERIFICATION_TYPES.WALLET_PROOF,
      $or: [
        { walletChallengeWindowStartedAt: { $exists: false } },
        { walletChallengeWindowStartedAt: null },
        { walletChallengeWindowStartedAt: { $lte: windowCutoff } },
      ],
    },
    {
      $set: {
        status: VERIFICATION_STATUSES.PENDING,
        providerName: "METAMASK_SIGNATURE",
        walletChallengeCount: 1,
        walletChallengeWindowStartedAt: now,
        walletChallengeAttempts: 0,
        ...challengeFields,
      },
      $unset: {
        walletChallengeConsumedAt: 1,
      },
    },
    { new: true }
  ).select(CHALLENGE_SELECT_FIELDS);

  if (record) {
    return record;
  }

  // Case 2: Existing record within active 1-hour window with remaining slots
  record = await VerificationRecord.findOneAndUpdate(
    {
      userId,
      verificationType: VERIFICATION_TYPES.WALLET_PROOF,
      walletChallengeWindowStartedAt: { $gt: windowCutoff },
      walletChallengeCount: { $lt: maxPerHour },
    },
    {
      $inc: { walletChallengeCount: 1 },
      $set: {
        status: VERIFICATION_STATUSES.PENDING,
        providerName: "METAMASK_SIGNATURE",
        walletChallengeAttempts: 0,
        ...challengeFields,
      },
      $unset: {
        walletChallengeConsumedAt: 1,
      },
    },
    { new: true }
  ).select(CHALLENGE_SELECT_FIELDS);

  if (record) {
    return record;
  }

  // Case 3: No WALLET_PROOF record exists yet for this user -> create atomically
  const existing = await VerificationRecord.findOne({
    userId,
    verificationType: VERIFICATION_TYPES.WALLET_PROOF,
  }).select("_id");

  if (!existing) {
    try {
      return await VerificationRecord.create({
        userId,
        verificationType: VERIFICATION_TYPES.WALLET_PROOF,
        status: VERIFICATION_STATUSES.PENDING,
        providerName: "METAMASK_SIGNATURE",
        walletChallengeCount: 1,
        walletChallengeWindowStartedAt: now,
        walletChallengeAttempts: 0,
        ...challengeFields,
      });
    } catch (err) {
      // A concurrent request created the initial record first; retry Case 2 atomically
      if (isDuplicateKeyError(err)) {
        return VerificationRecord.findOneAndUpdate(
          {
            userId,
            verificationType: VERIFICATION_TYPES.WALLET_PROOF,
            walletChallengeWindowStartedAt: { $gt: windowCutoff },
            walletChallengeCount: { $lt: maxPerHour },
          },
          {
            $inc: { walletChallengeCount: 1 },
            $set: {
              status: VERIFICATION_STATUSES.PENDING,
              providerName: "METAMASK_SIGNATURE",
              walletChallengeAttempts: 0,
              ...challengeFields,
            },
            $unset: {
              walletChallengeConsumedAt: 1,
            },
          },
          { new: true }
        ).select(CHALLENGE_SELECT_FIELDS);
      }
      throw err;
    }
  }

  return null;
}

/**
 * Issues a single-use, time-limited wallet ownership signing challenge for a
 * verified-phone, verified-identity CUSTOMER who does not yet have a linked wallet.
 *
 * PRIVACY: Deliberately does NOT check whether walletAddress belongs to another
 * account so this endpoint cannot be abused to probe which wallets are registered.
 * Ownership is enforced only after valid signature recovery in verifyChallenge().
 */
async function createChallenge(userId, walletAddressInput, requestMeta = {}) {
  const { ipAddress, userAgent } = requestMeta;

  const addressCheck = validateWalletAddress(walletAddressInput);
  if (!addressCheck.valid) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, addressCheck.message, {
      walletAddress: addressCheck.message,
    });
  }

  const normalizedAddress = addressCheck.value;
  const checksumAddress = addressCheck.checksumAddress;
  const maskedAddress = maskAddress(normalizedAddress);

  const user = await User.findById(userId);
  if (!user) {
    throw new AppError(401, ERROR_CODES.UNAUTHORIZED, "Account not found.");
  }

  if (user.role !== USER_ROLES.CUSTOMER) {
    throw new AppError(
      403,
      ERROR_CODES.FORBIDDEN,
      "Only customer accounts can link a wallet."
    );
  }

  if (!user.phoneVerified) {
    throw new AppError(
      403,
      ERROR_CODES.PHONE_NOT_VERIFIED,
      "Please verify your phone number before linking a wallet."
    );
  }

  if (
    user.identityStatus !== IDENTITY_STATUSES.VERIFIED ||
    !user.identityVerified
  ) {
    throw new AppError(
      403,
      ERROR_CODES.IDENTITY_NOT_VERIFIED,
      "Please complete identity verification before linking a wallet."
    );
  }

  if (user.walletAddress || user.walletLinked) {
    throw new AppError(
      409,
      ERROR_CODES.ACCOUNT_ALREADY_HAS_WALLET,
      "This account already has a linked wallet."
    );
  }

  const now = new Date();
  const ttlSeconds = config.wallet.challengeTtlSeconds;
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
  const chainId = config.wallet.chainId;
  const nonce = crypto.randomBytes(16).toString("hex");

  const challengeRecord = await claimChallengeSlot(
    user._id,
    {
      walletChallengeNonce: nonce,
      walletChallengeAddress: normalizedAddress,
      walletChallengeChainId: chainId,
      walletChallengeIssuedAt: now,
      walletChallengeExpiresAt: expiresAt,
    },
    now
  );

  if (!challengeRecord) {
    await logSecurityEvent({
      eventType: SECURITY_EVENT_TYPES.WALLET_CHALLENGE_LIMIT,
      severity: SECURITY_SEVERITIES.LOW,
      userId: user._id,
      ipAddress,
      userAgent,
      details: { maskedAddress },
    });

    throw new AppError(
      429,
      ERROR_CODES.WALLET_CHALLENGE_LIMIT,
      "You have requested too many wallet signing challenges. Please wait and try again later."
    );
  }

  const message = buildChallengeMessage({
    domain: config.wallet.domain,
    checksumAddress,
    nonce,
    issuedAt: now,
    expiresAt,
    chainId,
  });

  // Never log the nonce or full wallet address to SecurityLogs.
  await logSecurityEvent({
    eventType: SECURITY_EVENT_TYPES.WALLET_CHALLENGE_ISSUED,
    severity: SECURITY_SEVERITIES.LOW,
    userId: user._id,
    ipAddress,
    userAgent,
    details: {
      maskedAddress,
      chainId,
    },
  });

  return {
    message,
    walletAddress: checksumAddress,
    chainId,
    nonce,
    issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    expiresInSeconds: ttlSeconds,
  };
}

/**
 * Verifies an EIP-191 personal_sign signature against the server-rebuilt challenge
 * message, atomically consumes the single-use nonce, enforces 1-wallet-per-account
 * uniqueness, and links the wallet in MongoDB.
 *
 * SECURITY: Never trusts a client-supplied message, never logs signatures, nonces,
 * or full wallet addresses, and checks cross-account ownership only after valid
 * signature recovery and atomic nonce consumption.
 */
async function verifyChallenge(
  userId,
  { walletAddress, signature },
  requestMeta = {}
) {
  const { ipAddress, userAgent } = requestMeta;

  const addressCheck = validateWalletAddress(walletAddress);
  if (!addressCheck.valid) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, addressCheck.message, {
      walletAddress: addressCheck.message,
    });
  }

  const signatureCheck = validateSignature(signature);
  if (!signatureCheck.valid) {
    throw new AppError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      signatureCheck.message,
      { signature: signatureCheck.message }
    );
  }

  const normalizedAddress = addressCheck.value;
  const maskedAddress = maskAddress(normalizedAddress);

  // (a) Load User and verify role, phone, identity, and no existing linked wallet
  const user = await User.findById(userId);
  if (!user) {
    throw new AppError(401, ERROR_CODES.UNAUTHORIZED, "Account not found.");
  }

  if (user.role !== USER_ROLES.CUSTOMER) {
    throw new AppError(
      403,
      ERROR_CODES.FORBIDDEN,
      "Only customer accounts can link a wallet."
    );
  }

  if (!user.phoneVerified) {
    throw new AppError(
      403,
      ERROR_CODES.PHONE_NOT_VERIFIED,
      "Please verify your phone number before linking a wallet."
    );
  }

  if (
    user.identityStatus !== IDENTITY_STATUSES.VERIFIED ||
    !user.identityVerified
  ) {
    throw new AppError(
      403,
      ERROR_CODES.IDENTITY_NOT_VERIFIED,
      "Please complete identity verification before linking a wallet."
    );
  }

  if (user.walletAddress || user.walletLinked) {
    throw new AppError(
      409,
      ERROR_CODES.ACCOUNT_ALREADY_HAS_WALLET,
      "This account already has a linked wallet."
    );
  }

  // (b) Load active WALLET_PROOF challenge record and validate state
  const record = await VerificationRecord.findOne({
    userId: user._id,
    verificationType: VERIFICATION_TYPES.WALLET_PROOF,
  }).select(CHALLENGE_SELECT_FIELDS);

  if (!record || !record.walletChallengeNonce) {
    throw new AppError(
      400,
      ERROR_CODES.WALLET_CHALLENGE_NOT_REQUESTED,
      "No wallet signing challenge was requested. Please request a new message to sign."
    );
  }

  const now = new Date();
  if (
    record.walletChallengeConsumedAt ||
    !record.walletChallengeExpiresAt ||
    record.walletChallengeExpiresAt <= now
  ) {
    throw new AppError(
      400,
      ERROR_CODES.WALLET_CHALLENGE_EXPIRED,
      "This signing challenge has expired or was already used. Please request a new message."
    );
  }

  if (normalizedAddress !== record.walletChallengeAddress) {
    throw new AppError(
      400,
      ERROR_CODES.WALLET_CHALLENGE_MISMATCH,
      "Wallet address does not match the active signing challenge. Please request a new message."
    );
  }

  // (c) Atomically increment attempt count while ensuring challenge is active and unlocked
  const maxAttempts = config.wallet.maxVerifyAttempts;
  const attemptRecord = await VerificationRecord.findOneAndUpdate(
    {
      userId: user._id,
      verificationType: VERIFICATION_TYPES.WALLET_PROOF,
      walletChallengeNonce: record.walletChallengeNonce,
      walletChallengeConsumedAt: null,
      walletChallengeExpiresAt: { $gt: now },
      walletChallengeAttempts: { $lt: maxAttempts },
    },
    {
      $inc: { walletChallengeAttempts: 1 },
    },
    { new: true }
  ).select(CHALLENGE_SELECT_FIELDS);

  if (!attemptRecord) {
    const latest = await VerificationRecord.findOne({
      userId: user._id,
      verificationType: VERIFICATION_TYPES.WALLET_PROOF,
    }).select(CHALLENGE_SELECT_FIELDS);

    if (
      latest &&
      latest.walletChallengeNonce === record.walletChallengeNonce &&
      !latest.walletChallengeConsumedAt &&
      latest.walletChallengeExpiresAt &&
      latest.walletChallengeExpiresAt > now &&
      latest.walletChallengeAttempts >= maxAttempts
    ) {
      await logSecurityEvent({
        eventType: SECURITY_EVENT_TYPES.WALLET_CHALLENGE_LOCKED,
        severity: SECURITY_SEVERITIES.MEDIUM,
        userId: user._id,
        ipAddress,
        userAgent,
        details: { maskedAddress },
      });

      throw new AppError(
        429,
        ERROR_CODES.WALLET_CHALLENGE_LOCKED,
        "Too many failed verification attempts. Please request a new challenge."
      );
    }

    throw new AppError(
      400,
      ERROR_CODES.WALLET_CHALLENGE_EXPIRED,
      "This signing challenge has expired or was already used. Please request a new message."
    );
  }

  // (d) Rebuild the exact expected message on the server and recover the signer
  const rebuiltMessage = buildChallengeMessage({
    domain: config.wallet.domain,
    checksumAddress: ethers.getAddress(attemptRecord.walletChallengeAddress),
    nonce: attemptRecord.walletChallengeNonce,
    issuedAt: attemptRecord.walletChallengeIssuedAt,
    expiresAt: attemptRecord.walletChallengeExpiresAt,
    chainId: attemptRecord.walletChallengeChainId,
  });

  let recoveredAddress = null;
  try {
    recoveredAddress = ethers.verifyMessage(rebuiltMessage, signatureCheck.value);
  } catch (_verifyErr) {
    recoveredAddress = null;
  }

  if (
    !recoveredAddress ||
    recoveredAddress.toLowerCase() !== attemptRecord.walletChallengeAddress
  ) {
    const attemptsRemaining = Math.max(
      0,
      maxAttempts - attemptRecord.walletChallengeAttempts
    );

    // Never log the raw signature, nonce, or recovered address.
    await logSecurityEvent({
      eventType: SECURITY_EVENT_TYPES.WALLET_SIGNATURE_INVALID,
      severity: SECURITY_SEVERITIES.MEDIUM,
      userId: user._id,
      ipAddress,
      userAgent,
      details: {
        maskedAddress,
        attemptsRemaining,
      },
    });

    if (attemptsRemaining === 0) {
      await logSecurityEvent({
        eventType: SECURITY_EVENT_TYPES.WALLET_CHALLENGE_LOCKED,
        severity: SECURITY_SEVERITIES.MEDIUM,
        userId: user._id,
        ipAddress,
        userAgent,
        details: { maskedAddress },
      });

      throw new AppError(
        429,
        ERROR_CODES.WALLET_CHALLENGE_LOCKED,
        "Too many failed verification attempts. Please request a new challenge.",
        { attemptsRemaining: 0 }
      );
    }

    throw new AppError(
      400,
      ERROR_CODES.WALLET_SIGNATURE_INVALID,
      "Wallet signature could not be verified. Please sign the message with the selected MetaMask account.",
      { attemptsRemaining }
    );
  }

  // (e) Atomically consume the single-use challenge so concurrent replays cannot pass.
  // Once consumed here, if step (f) or (g) fails the user must request a new challenge.
  const consumed = await VerificationRecord.findOneAndUpdate(
    {
      userId: user._id,
      verificationType: VERIFICATION_TYPES.WALLET_PROOF,
      walletChallengeNonce: attemptRecord.walletChallengeNonce,
      walletChallengeConsumedAt: null,
      walletChallengeExpiresAt: { $gt: now },
    },
    {
      $set: {
        walletChallengeConsumedAt: now,
      },
    },
    { new: true }
  );

  if (!consumed) {
    throw new AppError(
      400,
      ERROR_CODES.WALLET_CHALLENGE_EXPIRED,
      "This signing challenge has expired or was already used. Please request a new message."
    );
  }

  // (f) Pre-check whether another user already owns this wallet address.
  // Never leaks the other user's email, name, or ID in the API response.
  const existingOwner = await User.findOne({
    walletAddress: normalizedAddress,
    _id: { $ne: user._id },
  })
    .select("_id")
    .lean();

  if (existingOwner) {
    await logSecurityEvent({
      eventType: SECURITY_EVENT_TYPES.WALLET_ALREADY_LINKED_ATTEMPT,
      severity: SECURITY_SEVERITIES.HIGH,
      userId: user._id,
      ipAddress,
      userAgent,
      details: {
        maskedAddress,
        conflictingUserId: String(existingOwner._id),
        source: "PRE_CHECK",
      },
    });

    throw new AppError(
      409,
      ERROR_CODES.WALLET_ALREADY_LINKED,
      "This wallet is already linked to another account. Use a different wallet."
    );
  }

  // (g) Atomically link the wallet on User; MongoDB's unique partial index on
  // walletAddress is the final authority under concurrent multi-account races.
  let updatedUser;
  try {
    updatedUser = await User.findOneAndUpdate(
      {
        _id: user._id,
        identityStatus: IDENTITY_STATUSES.VERIFIED,
        phoneVerified: true,
        $or: [{ walletAddress: { $exists: false } }, { walletAddress: null }],
      },
      {
        $set: {
          walletAddress: normalizedAddress,
          walletLinked: true,
          walletLinkedAt: now,
        },
      },
      { new: true }
    );
  } catch (err) {
    if (isDuplicateKeyError(err, "walletAddress")) {
      const owner = await User.findOne({
        walletAddress: normalizedAddress,
        _id: { $ne: user._id },
      })
        .select("_id")
        .lean();

      await logSecurityEvent({
        eventType: SECURITY_EVENT_TYPES.WALLET_ALREADY_LINKED_ATTEMPT,
        severity: SECURITY_SEVERITIES.HIGH,
        userId: user._id,
        ipAddress,
        userAgent,
        details: {
          maskedAddress,
          conflictingUserId: owner ? String(owner._id) : null,
          source: "UNIQUE_INDEX",
        },
      });

      throw new AppError(
        409,
        ERROR_CODES.WALLET_ALREADY_LINKED,
        "This wallet is already linked to another account. Use a different wallet."
      );
    }
    throw err;
  }

  if (!updatedUser) {
    throw new AppError(
      409,
      ERROR_CODES.ACCOUNT_ALREADY_HAS_WALLET,
      "This account already has a linked wallet."
    );
  }

  // (h) Mark WALLET_PROOF verification record as VERIFIED and record audit event
  await VerificationRecord.updateOne(
    {
      userId: user._id,
      verificationType: VERIFICATION_TYPES.WALLET_PROOF,
    },
    {
      $set: {
        status: VERIFICATION_STATUSES.VERIFIED,
        walletAddress: normalizedAddress,
        verifiedAt: now,
      },
    }
  );

  await logSecurityEvent({
    eventType: SECURITY_EVENT_TYPES.WALLET_LINKED,
    severity: SECURITY_SEVERITIES.LOW,
    userId: user._id,
    ipAddress,
    userAgent,
    details: {
      maskedAddress,
      chainId: attemptRecord.walletChallengeChainId,
    },
  });

  return {
    walletAddress: normalizedAddress,
    linkedAt: now.toISOString(),
  };
}

module.exports = {
  createChallenge,
  verifyChallenge,
};
