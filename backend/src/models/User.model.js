const mongoose = require("mongoose");
const {
  USER_ROLES,
  USER_ROLE_VALUES,
  ACCOUNT_STATUSES,
  ACCOUNT_STATUS_VALUES,
  IDENTITY_STATUSES,
  IDENTITY_STATUS_VALUES,
} = require("../config/constants");
const {
  BYTES32_HEX_REGEX,
  IDENTITY_HASH_REGEX,
  normalizeEmail,
  normalizePhone,
  walletAddressSetter,
  walletAddressValidator,
} = require("../utils/normalize");

const userSchema = new mongoose.Schema(
  {
    // Fan or staff display name shown in dashboards and receipts
    fullName: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 100,
    },
    // Normalized lowercase login email address (unique across all accounts)
    email: {
      type: String,
      required: true,
      trim: true,
      maxlength: 254,
      set: normalizeEmail,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "must be a valid email address"],
    },
    // Normalized phone number in E.164-like format used for simulated phone OTP
    phone: {
      type: String,
      required: true,
      trim: true,
      minlength: 7,
      maxlength: 20,
      set: normalizePhone,
      match: [/^\+?\d{7,15}$/, "must be a valid phone number"],
    },
    // bcryptjs password hash (excluded from queries and JSON by default)
    passwordHash: {
      type: String,
      required: true,
      minlength: 20,
      maxlength: 200,
      select: false,
    },
    // Role governing API access control (CUSTOMER, ORGANIZER, ADMIN, GATE_STAFF)
    role: {
      type: String,
      required: true,
      enum: USER_ROLE_VALUES,
      default: USER_ROLES.CUSTOMER,
    },
    // Account standing allowing admins to suspend abusive accounts
    accountStatus: {
      type: String,
      required: true,
      enum: ACCOUNT_STATUS_VALUES,
      default: ACCOUNT_STATUSES.ACTIVE,
    },
    // True after the user completes simulated phone OTP verification
    phoneVerified: {
      type: Boolean,
      required: true,
      default: false,
    },
    // True after simulated KYC passes and duplicate-identity check clears
    identityVerified: {
      type: Boolean,
      required: true,
      default: false,
    },
    // Detailed identity verification status (NOT_STARTED, VERIFIED, REJECTED)
    identityStatus: {
      type: String,
      required: true,
      enum: IDENTITY_STATUS_VALUES,
      default: IDENTITY_STATUSES.NOT_STARTED,
    },
    // Timestamp when simulated identity verification succeeded
    identityVerifiedAt: {
      type: Date,
    },
    // True after MetaMask challenge proof and on-chain verifyWallet succeed
    walletLinked: {
      type: Boolean,
      required: true,
      default: false,
    },
    // Privacy-preserving keyed HMAC-SHA256 hash of verified identity (never raw ID data)
    identityHash: {
      type: String,
      trim: true,
      select: false,
      match: [
        IDENTITY_HASH_REGEX,
        "must be a 64-character hex identity hash (or 0x-prefixed bytes32)",
      ],
    },
    // Lowercased MetaMask wallet address linked to this verified account
    walletAddress: {
      type: String,
      set: walletAddressSetter,
      validate: walletAddressValidator,
    },
    // Timestamp when MetaMask wallet signature linking succeeded
    walletLinkedAt: {
      type: Date,
    },
    // On-chain transaction hash recorded when FairTicket.verifyWallet succeeded
    walletLinkTxHash: {
      type: String,
      trim: true,
      match: [BYTES32_HEX_REGEX, "must be a valid transaction hash"],
    },
    // Single-use random challenge nonce for MetaMask signature verification
    walletAuthNonce: {
      type: String,
      trim: true,
      maxlength: 128,
      select: false,
    },
    // Expiry timestamp for the active MetaMask authentication challenge nonce
    walletAuthNonceExpiresAt: {
      type: Date,
      select: false,
    },
    // Consecutive failed login attempts toward brute-force lockout
    failedLoginCount: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      select: false,
      validate: {
        validator: Number.isSafeInteger,
        message: "failedLoginCount must be a whole number",
      },
    },
    // Temporary lockout expiry timestamp after exceeding AUTH_MAX_FAILED_LOGINS
    lockedUntil: {
      type: Date,
      select: false,
    },
  },
  {
    timestamps: true,
    strict: true,
    toJSON: {
      transform: (_doc, ret) => {
        delete ret.__v;
        delete ret.passwordHash;
        delete ret.identityHash;
        delete ret.walletAuthNonce;
        delete ret.walletAuthNonceExpiresAt;
        delete ret.failedLoginCount;
        delete ret.lockedUntil;
        return ret;
      },
    },
  }
);

userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ phone: 1 }, { unique: true });
userSchema.index(
  { identityHash: 1 },
  {
    unique: true,
    partialFilterExpression: { identityHash: { $type: "string" } },
  }
);
userSchema.index(
  { walletAddress: 1 },
  {
    unique: true,
    partialFilterExpression: { walletAddress: { $type: "string" } },
  }
);
userSchema.index({ role: 1, accountStatus: 1 });

module.exports = mongoose.model("User", userSchema);
