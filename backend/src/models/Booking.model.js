const mongoose = require("mongoose");
const {
  MAX_ACTIVE_TICKETS,
  BOOKING_STATUSES,
  BOOKING_STATUS_VALUES,
} = require("../config/constants");
const { paiseSchemaValidator } = require("../utils/money");
const {
  BYTES32_HEX_REGEX,
  walletAddressSetter,
  walletAddressValidator,
} = require("../utils/normalize");

const bookingSchema = new mongoose.Schema(
  {
    // Human-readable unique booking confirmation code (e.g. FT-2026-849201)
    bookingReference: {
      type: String,
      required: true,
      trim: true,
      maxlength: 64,
    },
    // Event being booked
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
      required: true,
    },
    // Buyer account reference
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Buyer verified identity hash
    identityHash: {
      type: String,
      required: true,
      trim: true,
      match: [BYTES32_HEX_REGEX, "must be a 0x-prefixed 32-byte hex hash"],
    },
    // Lowercased MetaMask wallet receiving the minted tickets
    walletAddress: {
      type: String,
      required: true,
      set: walletAddressSetter,
      validate: walletAddressValidator,
    },
    // Originating BookingHold (unique so a single hold can produce at most one booking)
    holdId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BookingHold",
      required: true,
    },
    // Confirmed simulated Payment record backing this booking
    paymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Payment",
      required: true,
    },
    // Number of primary tickets purchased in this booking (1 or 2)
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
    // Exact primary purchase amount paid in integer paise
    totalAmountPaise: {
      type: Number,
      required: true,
      min: 100,
      validate: paiseSchemaValidator,
    },
    // Single-use bytes32 nonce included in the backend ECDSA permit for purchaseTicket
    authNonce: {
      type: String,
      required: true,
      trim: true,
      match: [BYTES32_HEX_REGEX, "must be a 0x-prefixed 32-byte hex nonce"],
    },
    // Unix timestamp (in seconds) when the backend ECDSA permit expires
    authExpiry: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isSafeInteger,
        message: "authExpiry must be a whole Unix timestamp in seconds",
      },
    },
    // Lifecycle status tracking payment to on-chain mint confirmation
    status: {
      type: String,
      required: true,
      enum: BOOKING_STATUS_VALUES,
      default: BOOKING_STATUSES.PENDING_ONCHAIN,
    },
    // Confirmed Hardhat transaction hash from FairTicket.purchaseTicket
    mintTxHash: {
      type: String,
      trim: true,
      match: [BYTES32_HEX_REGEX, "must be a valid transaction hash"],
    },
    // List of Ticket document IDs minted once on-chain confirmation completes
    ticketIds: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Ticket",
        },
      ],
      required: true,
      default: [],
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

bookingSchema.index({ bookingReference: 1 }, { unique: true });
bookingSchema.index({ holdId: 1 }, { unique: true });
bookingSchema.index({ paymentId: 1 }, { unique: true });
bookingSchema.index({ authNonce: 1 }, { unique: true });
bookingSchema.index(
  { mintTxHash: 1 },
  {
    unique: true,
    partialFilterExpression: { mintTxHash: { $type: "string" } },
  }
);
bookingSchema.index({ userId: 1, createdAt: -1 });
bookingSchema.index({ eventId: 1 });

module.exports = mongoose.model("Booking", bookingSchema);
