const mongoose = require("mongoose");
const {
  MAX_ACTIVE_TICKETS,
  BOOKING_HOLD_STATUSES,
  BOOKING_HOLD_STATUS_VALUES,
} = require("../config/constants");
const { paiseSchemaValidator } = require("../utils/money");
const { BYTES32_HEX_REGEX } = require("../utils/normalize");

const bookingHoldSchema = new mongoose.Schema(
  {
    // Event for which ticket inventory is temporarily held
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
      required: true,
    },
    // Verified fan holding this temporary reservation
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Verified identity hash counted against the per-event 2-ticket cap
    identityHash: {
      type: String,
      required: true,
      trim: true,
      match: [BYTES32_HEX_REGEX, "must be a 0x-prefixed 32-byte hex hash"],
    },
    // Queue entry that unlocked this hold (unique so one turn cannot reset timers)
    queueEntryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "QueueEntry",
      required: true,
    },
    // Quantity of tickets temporarily reserved (1 or 2)
    quantity: {
      type: Number,
      required: true,
      min: 1,
      max: MAX_ACTIVE_TICKETS,
      validate: {
        validator: Number.isSafeInteger,
        message: "quantity must be a whole number",
      },
    },
    // Snapshot of the event base price in integer paise at hold creation
    unitPricePaise: {
      type: Number,
      required: true,
      min: 100,
      validate: paiseSchemaValidator,
    },
    // Total integer paise due for this hold (quantity * unitPricePaise)
    totalPricePaise: {
      type: Number,
      required: true,
      min: 100,
      validate: paiseSchemaValidator,
    },
    // Hold state machine status (ACTIVE, CAPTCHA_PASSED, PAYMENT_PENDING, COMPLETED, EXPIRED, RELEASED)
    status: {
      type: String,
      required: true,
      enum: BOOKING_HOLD_STATUS_VALUES,
      default: BOOKING_HOLD_STATUSES.ACTIVE,
    },
    // Identifier of the most recent CAPTCHA challenge issued for this hold
    captchaChallengeId: {
      type: String,
      trim: true,
      maxlength: 64,
    },
    // Timestamp when the fan solved the human verification CAPTCHA
    captchaVerifiedAt: {
      type: Date,
    },
    // Counter of blocked attempts to extend the non-extendable hold timer
    extensionBlockedCount: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: {
        validator: Number.isSafeInteger,
        message: "extensionBlockedCount must be a whole number",
      },
    },
    // Server timestamp when the hold began
    startedAt: {
      type: Date,
      required: true,
    },
    // Immutable server deadline after which holdExpiry.job.js releases inventory
    expiresAt: {
      type: Date,
      required: true,
      validate: {
        validator: function (value) {
          if (!this.startedAt || !value) {
            return true;
          }
          return value > this.startedAt;
        },
        message: "expiresAt must be after startedAt",
      },
    },
    // Timestamp when the hold was expired or manually released
    releasedAt: {
      type: Date,
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

bookingHoldSchema.index({ queueEntryId: 1 }, { unique: true });
bookingHoldSchema.index(
  { eventId: 1, userId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: BOOKING_HOLD_STATUSES.ACTIVE },
  }
);
bookingHoldSchema.index({ status: 1, expiresAt: 1 });
bookingHoldSchema.index({ userId: 1, eventId: 1, status: 1 });

module.exports = mongoose.model("BookingHold", bookingHoldSchema);
