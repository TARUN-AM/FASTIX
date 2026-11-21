const mongoose = require("mongoose");
const {
  QUEUE_ENTRY_STATUSES,
  QUEUE_ENTRY_STATUS_VALUES,
} = require("../config/constants");
const { BYTES32_HEX_REGEX } = require("../utils/normalize");

const queueEntrySchema = new mongoose.Schema(
  {
    // Event whose randomized queue this entry belongs to
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
      required: true,
    },
    // Verified customer who registered for the queue
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Verified identity hash preventing one person from entering twice via multiple accounts
    identityHash: {
      type: String,
      required: true,
      trim: true,
      match: [BYTES32_HEX_REGEX, "must be a 0x-prefixed 32-byte hex hash"],
    },
    // Current queue progression status (REGISTERED, WAITING, ACTIVE_TURN, BOOKED, EXPIRED, CANCELLED)
    status: {
      type: String,
      required: true,
      enum: QUEUE_ENTRY_STATUS_VALUES,
      default: QUEUE_ENTRY_STATUSES.REGISTERED,
    },
    // 1-based random queue position assigned after registration closes
    queuePosition: {
      type: Number,
      min: 1,
      validate: {
        validator: (value) => value === undefined || Number.isSafeInteger(value),
        message: "queuePosition must be a whole number",
      },
    },
    // Timestamp when the fan registered during the open window
    joinedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    // Timestamp when this user's status transitioned to ACTIVE_TURN
    turnActivatedAt: {
      type: Date,
    },
    // Server deadline to start and finish booking during this active turn
    turnExpiresAt: {
      type: Date,
    },
    // Reference to the BookingHold spawned by this queue turn, if created
    activeHoldId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BookingHold",
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

queueEntrySchema.index({ eventId: 1, userId: 1 }, { unique: true });
queueEntrySchema.index({ eventId: 1, identityHash: 1 }, { unique: true });
queueEntrySchema.index(
  { eventId: 1, queuePosition: 1 },
  {
    unique: true,
    partialFilterExpression: { queuePosition: { $type: "number" } },
  }
);
queueEntrySchema.index({ eventId: 1, status: 1, queuePosition: 1 });

module.exports = mongoose.model("QueueEntry", queueEntrySchema);
