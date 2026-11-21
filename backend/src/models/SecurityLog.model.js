const mongoose = require("mongoose");
const {
  SECURITY_EVENT_TYPE_VALUES,
  SECURITY_SEVERITIES,
  SECURITY_SEVERITY_VALUES,
} = require("../config/constants");
const { isValidPaise } = require("../utils/money");
const {
  walletAddressSetter,
  walletAddressValidator,
} = require("../utils/normalize");

const optionalPaiseValidator = Object.freeze({
  validator: (value) => value === undefined || isValidPaise(value),
  message: "must be a whole number of paise",
});

const securityLogSchema = new mongoose.Schema(
  {
    // Category of blocked attack, policy violation, scalping attempt, or Trust Guardian alert
    eventType: {
      type: String,
      required: true,
      enum: SECURITY_EVENT_TYPE_VALUES,
    },
    // Incident severity level shown on the Admin Dashboard (LOW, MEDIUM, HIGH, CRITICAL)
    severity: {
      type: String,
      required: true,
      enum: SECURITY_SEVERITY_VALUES,
      default: SECURITY_SEVERITIES.MEDIUM,
    },
    // Authenticated user associated with this security event, if applicable
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    // Lowercased wallet address involved in the blocked action, if applicable
    walletAddress: {
      type: String,
      set: walletAddressSetter,
      validate: walletAddressValidator,
    },
    // Event involved in the security incident, if applicable
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
    },
    // Ticket involved in the security incident, if applicable
    ticketId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ticket",
    },
    // Rejected asking price in integer paise for RESALE_CAP_VIOLATION / SCALPING_ATTEMPT_5X
    attemptedPricePaise: {
      type: Number,
      validate: optionalPaiseValidator,
    },
    // Official 110% maximum cap in integer paise at the time of the rejected attempt
    allowedMaxPricePaise: {
      type: Number,
      validate: optionalPaiseValidator,
    },
    // Client IP address observed on the request
    ipAddress: {
      type: String,
      trim: true,
      maxlength: 64,
    },
    // Client User-Agent header observed on the request
    userAgent: {
      type: String,
      trim: true,
      maxlength: 512,
    },
    // Structured diagnostic details (rule codes, mismatch summary; never raw PII or secrets)
    details: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
      default: () => ({}),
    },
  },
  {
    timestamps: true,
    strict: true,
    toJSON: {
      transform: (_doc, ret) => {
        delete ret.__v;
        return ret;
      },
    },
  }
);

// APPEND-ONLY PROTECTION:
// Note: These Mongoose hooks protect the Mongoose API layer only. A production
// deployment must also enforce append-only guarantees using MongoDB database-level
// role permissions (granting insert/find only and revoking update/delete).
const APPEND_ONLY_ERROR =
  "SecurityLog is append-only and existing audit entries cannot be modified or deleted.";

securityLogSchema.pre("save", function () {
  if (!this.isNew) {
    throw new Error(APPEND_ONLY_ERROR);
  }
});

const DOCUMENT_AND_QUERY_HOOKS = ["updateOne", "deleteOne"];
const QUERY_ONLY_HOOKS = [
  "updateMany",
  "findOneAndUpdate",
  "findOneAndDelete",
  "deleteMany",
  "replaceOne",
];

for (const hookName of DOCUMENT_AND_QUERY_HOOKS) {
  securityLogSchema.pre(hookName, { document: true, query: true }, function () {
    throw new Error(APPEND_ONLY_ERROR);
  });
}

for (const hookName of QUERY_ONLY_HOOKS) {
  securityLogSchema.pre(hookName, function () {
    throw new Error(APPEND_ONLY_ERROR);
  });
}

securityLogSchema.index({ createdAt: -1 });
securityLogSchema.index({ eventType: 1, severity: 1, createdAt: -1 });
securityLogSchema.index({ eventType: 1, createdAt: -1 });
securityLogSchema.index({ userId: 1, createdAt: -1 });
securityLogSchema.index({ severity: 1 });

module.exports = mongoose.model("SecurityLog", securityLogSchema);
