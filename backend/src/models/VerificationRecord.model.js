const mongoose = require("mongoose");
const {
  VERIFICATION_TYPES,
  VERIFICATION_TYPE_VALUES,
  VERIFICATION_STATUSES,
  VERIFICATION_STATUS_VALUES,
  IDENTITY_STATUS_VALUES,
  IDENTITY_DOC_TYPE_VALUES,
} = require("../config/constants");
const {
  IDENTITY_HASH_REGEX,
  walletAddressSetter,
  walletAddressValidator,
} = require("../utils/normalize");

const verificationRecordSchema = new mongoose.Schema(
  {
    // Reference to the user undergoing this verification step
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Distinguishes phone OTP, simulated KYC, and MetaMask wallet proof steps
    verificationType: {
      type: String,
      required: true,
      enum: VERIFICATION_TYPE_VALUES,
    },
    // Current outcome of this verification attempt (PENDING, VERIFIED, REJECTED)
    status: {
      type: String,
      required: true,
      enum: VERIFICATION_STATUS_VALUES,
      default: VERIFICATION_STATUSES.PENDING,
    },
    // Salted SHA-256 hash of the 6-digit OTP (never stored in plaintext)
    otpHash: {
      type: String,
      maxlength: 128,
      select: false,
    },
    // Expiration time for an active PHONE_OTP verification challenge
    otpExpiresAt: {
      type: Date,
    },
    // Number of failed OTP guesses made against this challenge
    otpAttemptCount: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: {
        validator: Number.isSafeInteger,
        message: "otpAttemptCount must be a whole number",
      },
    },
    // Type of simulated ID chosen during MOCK_KYC (never real Aadhaar)
    identityDocType: {
      type: String,
      enum: IDENTITY_DOC_TYPE_VALUES,
    },
    // Active simulated document type (e.g. DEMO_ID)
    documentType: {
      type: String,
      enum: IDENTITY_DOC_TYPE_VALUES,
    },
    // Reserved legacy field; privacy-hardened mock KYC never stores any part of an ID
    maskedIdPreview: {
      type: String,
      trim: true,
      maxlength: 32,
    },
    // Privacy-preserving keyed HMAC-SHA256 hash stored only when verified (never returned)
    identityHash: {
      type: String,
      trim: true,
      select: false,
      match: [
        IDENTITY_HASH_REGEX,
        "must be a 64-character hex identity hash (or 0x-prefixed bytes32)",
      ],
    },
    // Detailed identity verification status (NOT_STARTED, VERIFIED, REJECTED)
    identityStatus: {
      type: String,
      enum: IDENTITY_STATUS_VALUES,
    },
    // Structured rejection code (NAME_MISMATCH or DOCUMENT_REJECTED)
    reasonCode: {
      type: String,
      trim: true,
      maxlength: 80,
    },
    // Random receipt reference returned by identity provider (never derived from ID number)
    providerReference: {
      type: String,
      trim: true,
      maxlength: 100,
    },
    // Timestamp when user granted consent for simulated identity check
    consentAt: {
      type: Date,
    },
    // Version identifier for consent wording accepted by user
    consentVersion: {
      type: String,
      trim: true,
      maxlength: 32,
    },
    // Rolling 24-hour attempt count for simulated identity verification
    attemptCount: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: {
        validator: Number.isSafeInteger,
        message: "attemptCount must be a whole number",
      },
    },
    // Start timestamp of the current rolling 24-hour attempt window
    attemptWindowStartedAt: {
      type: Date,
    },
    // Lowercased wallet address proven during WALLET_PROOF
    walletAddress: {
      type: String,
      set: walletAddressSetter,
      validate: walletAddressValidator,
    },
    // Name of the verification provider adapter (simulated in demo, pluggable later)
    providerName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
      default: "SIMULATED_DEMO_PROVIDER",
    },
    // Reason code or explanation if this verification attempt was rejected
    rejectionReason: {
      type: String,
      trim: true,
      maxlength: 200,
    },
    // Timestamp when this verification step succeeded
    verifiedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
    strict: true,
    toJSON: {
      transform: (_doc, ret) => {
        delete ret.__v;
        delete ret.otpHash;
        delete ret.identityHash;
        return ret;
      },
    },
  }
);

verificationRecordSchema.index({ userId: 1, verificationType: 1, createdAt: -1 });
verificationRecordSchema.index(
  { userId: 1, verificationType: 1 },
  {
    unique: true,
    partialFilterExpression: {
      verificationType: VERIFICATION_TYPES.MOCK_KYC,
    },
  }
);
verificationRecordSchema.index({ identityHash: 1, status: 1 });
// Enforces at most one VERIFIED record per identityHash while still allowing
// REJECTED duplicate-identity audit entries as defined in ARCHITECTURE.md section 9.1.
verificationRecordSchema.index(
  { identityHash: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: VERIFICATION_STATUSES.VERIFIED,
      identityHash: { $type: "string" },
    },
  }
);

module.exports = mongoose.model("VerificationRecord", verificationRecordSchema);
