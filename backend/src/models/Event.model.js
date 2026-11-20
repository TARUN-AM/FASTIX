const mongoose = require("mongoose");
const {
  MAX_ACTIVE_TICKETS,
  DEFAULT_HOLD_MINUTES,
  MIN_HOLD_MINUTES,
  MAX_HOLD_MINUTES,
  EVENT_CATEGORY_VALUES,
  EVENT_STATUSES,
  EVENT_STATUS_VALUES,
} = require("../config/constants");
const {
  isValidPaise,
  calculateMaxResalePrice,
  paiseSchemaValidator,
} = require("../utils/money");
const { BYTES32_HEX_REGEX } = require("../utils/normalize");

const eventSchema = new mongoose.Schema(
  {
    // Unique numeric event ID synchronized with FairTicket.createEvent on-chain
    onChainEventId: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isSafeInteger,
        message: "onChainEventId must be a whole number",
      },
    },
    // Organizer user who created and manages this event
    organizerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Public event title displayed in listings and tickets
    title: {
      type: String,
      required: true,
      trim: true,
      minlength: 3,
      maxlength: 150,
    },
    // Performing artist, band, or team name
    artist: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 100,
    },
    // Event category used for browse filtering
    category: {
      type: String,
      required: true,
      enum: EVENT_CATEGORY_VALUES,
    },
    // Full event description shown on Event Details
    description: {
      type: String,
      required: true,
      trim: true,
      minlength: 10,
      maxlength: 2000,
    },
    // Stadium, arena, or hall name
    venueName: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 150,
    },
    // City where the event takes place
    city: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 80,
    },
    // Scheduled event start date and time
    eventDate: {
      type: Date,
      required: true,
    },
    // Opening timestamp for verified fans to join the queue registration window
    registrationOpenAt: {
      type: Date,
      required: true,
    },
    // Closing timestamp after which randomized queue allocation can run
    registrationCloseAt: {
      type: Date,
      required: true,
      validate: {
        validator: function (value) {
          if (!this.registrationOpenAt || !value) {
            return true;
          }
          return value > this.registrationOpenAt;
        },
        message: "registrationCloseAt must be after registrationOpenAt",
      },
    },
    // Total primary ticket supply for this event
    totalTickets: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isSafeInteger,
        message: "totalTickets must be a whole number",
      },
    },
    // Remaining unheld, unsold primary tickets (decremented atomically on hold)
    availableTickets: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isSafeInteger,
        message: "availableTickets must be a whole number",
      },
    },
    // Total primary tickets permanently confirmed and minted on-chain
    soldTickets: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: {
        validator: Number.isSafeInteger,
        message: "soldTickets must be a whole number",
      },
    },
    // Original primary ticket price stored as integer paise (min Rs 1.00 = 100 paise)
    basePricePaise: {
      type: Number,
      required: true,
      min: 100,
      validate: paiseSchemaValidator,
    },
    // Precomputed 110% official resale cap in integer paise: floor(basePricePaise * 110 / 100)
    maxResalePricePaise: {
      type: Number,
      required: true,
      min: 100,
      validate: paiseSchemaValidator,
    },
    // Maximum active + redeemed tickets allowed per verified identity for this event
    maxTicketsPerIdentity: {
      type: Number,
      required: true,
      default: MAX_ACTIVE_TICKETS,
      min: 1,
      max: MAX_ACTIVE_TICKETS,
      validate: {
        validator: Number.isSafeInteger,
        message: "maxTicketsPerIdentity must be a whole number",
      },
    },
    // Configurable timed booking hold duration in whole minutes (1 to 15, default 5)
    holdDurationMinutes: {
      type: Number,
      required: true,
      default: DEFAULT_HOLD_MINUTES,
      min: MIN_HOLD_MINUTES,
      max: MAX_HOLD_MINUTES,
      validate: {
        validator: (value) =>
          Number.isSafeInteger(value) &&
          value >= MIN_HOLD_MINUTES &&
          value <= MAX_HOLD_MINUTES,
        message: `holdDurationMinutes must be a whole number between ${MIN_HOLD_MINUTES} and ${MAX_HOLD_MINUTES}`,
      },
    },
    // Number of queue users promoted into active booking turns simultaneously
    activeBatchSize: {
      type: Number,
      required: true,
      default: 5,
      min: 1,
      validate: {
        validator: Number.isSafeInteger,
        message: "activeBatchSize must be a whole number",
      },
    },
    // Published random seed used to deterministically shuffle queue entries
    queueShuffleSeed: {
      type: String,
      trim: true,
      maxlength: 64,
    },
    // SHA-256 commitment hash of the final ordered queue for public auditing
    queueShuffleHash: {
      type: String,
      trim: true,
      match: [BYTES32_HEX_REGEX, "must be a 0x-prefixed 32-byte hex hash"],
    },
    // Timestamp when randomized queue allocation finished
    queueAllocatedAt: {
      type: Date,
    },
    // Current lifecycle status of the event
    status: {
      type: String,
      required: true,
      enum: EVENT_STATUS_VALUES,
      default: EVENT_STATUSES.DRAFT,
    },
    // Hardhat transaction hash recorded when FairTicket.createEvent succeeded
    createEventTxHash: {
      type: String,
      trim: true,
      match: [BYTES32_HEX_REGEX, "must be a valid transaction hash"],
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

eventSchema.pre("validate", function () {
  if (isValidPaise(this.basePricePaise)) {
    const computedMax = calculateMaxResalePrice(this.basePricePaise);
    if (this.maxResalePricePaise === undefined) {
      this.maxResalePricePaise = computedMax;
    } else if (
      isValidPaise(this.maxResalePricePaise) &&
      this.maxResalePricePaise > computedMax
    ) {
      this.invalidate(
        "maxResalePricePaise",
        `maxResalePricePaise cannot exceed the 110% cap (${computedMax} paise)`
      );
    }
  }
});

eventSchema.index({ onChainEventId: 1 }, { unique: true });
eventSchema.index({ status: 1, eventDate: 1 });
eventSchema.index({ organizerId: 1, createdAt: -1 });

module.exports = mongoose.model("Event", eventSchema);
