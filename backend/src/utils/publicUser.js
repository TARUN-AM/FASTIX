const { IDENTITY_STATUSES } = require("../config/constants");

/**
 * Returns a strictly whitelisted, API-safe user projection.
 * Never exposes passwordHash, identityHash, walletAuthNonce, or internal fields.
 */
function toPublicUser(user) {
  if (!user) {
    return null;
  }

  const identityStatus =
    user.identityStatus ||
    (user.identityVerified
      ? IDENTITY_STATUSES.VERIFIED
      : IDENTITY_STATUSES.NOT_STARTED);

  return {
    id: String(user._id || user.id),
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    role: user.role,
    accountStatus: user.accountStatus,
    phoneVerified: Boolean(user.phoneVerified),
    identityVerified: identityStatus === IDENTITY_STATUSES.VERIFIED,
    identityStatus,
    identityVerifiedAt: user.identityVerifiedAt || null,
    walletLinked: Boolean(user.walletLinked),
    walletAddress: user.walletAddress || null,
    walletLinkedAt: user.walletLinkedAt || null,
    createdAt: user.createdAt || null,
    updatedAt: user.updatedAt || null,
  };
}

module.exports = {
  toPublicUser,
};
