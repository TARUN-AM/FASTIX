const mongoose = require("mongoose");
const {
  TICKET_STATUSES,
  TICKET_STATUS_VALUES,
} = require("../config/constants");
const {
  isValidPaise,
  calculateMaxResalePrice,
  paiseSchemaValidator,
} = require("../utils/money");
const {
  BYTES32_HEX_REGEX,
  walletAddressSetter,
  walletAddressValidator,
} = require("../utils/normalize");

const ticketSchema = new mongoose.Schema(
  {
    // Exact uint256 ticketId emitted by FairTicket.sol (unique across the platform)
    onChainTicketId: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isSafeInteger,
        message: "onChainTicketId must be a whole number",
      },
    },
    // Event this ticket grants entry to
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
      required: true,
    },
    // Mirrors Events.onChainEventId for direct smart contract consistency checks
    onChainEventId: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isSafeInteger,
        message: "onChainEventId must be a whole number",
      },
    },
    // Original primary Booking that minted this ticket
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
    },
    // First verified buyer who purchased this ticket from primary sale
    originalBuyerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Lowercased wallet address that originally minted this ticket
    originalOwnerWallet: {
      type: String,
      required: true,
      set: walletAddressSetter,
      validate: walletAddressValidator,
    },
    // Current verified owner account (updated after official resale)
    currentOwnerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Current on-chain owner wallet address (lowercased)
    currentOwnerWallet: {
      type: String,
      required: true,
      set: walletAddressSetter,
      validate: walletAddressValidator,
    },
    // Current owner's privacy-preserving identity hash for per-identity 2-ticket checks
    currentOwnerIdentityHash: {
      type: String,
      required: true,
      trim: true,
      match: [BYTES32_HEX_REGEX, "must be a 0x-prefixed 32-byte hex hash"],
    },
    // Original primary purchase price in integer paise
    originalPricePaise: {
      type: Number,
      required: true,
      min: 100,
      validate: paiseSchemaValidator,
    },
    // Most recent confirmed primary or official resale price in integer paise
    lastSalePricePaise: {
      type: Number,
      required: true,
      min: 100,
      validate: paiseSchemaValidator,
    },
    // Immutable 110% maximum official resale cap in integer paise
    maxResalePricePaise: {
      type: Number,
      required: true,
      min: 100,
      validate: paiseSchemaValidator,
    },
    // Total number of completed official resales for this ticket
    resaleCount: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: {
        validator: Number.isSafeInteger,
        message: "resaleCount must be a whole number",
      },
    },
    // Current lifecycle state (ACTIVE, LISTED_FOR_RESALE, USED, REVOKED)
    status: {
      type: String,
      required: true,
      enum: TICKET_STATUS_VALUES,
      default: TICKET_STATUSES.ACTIVE,
    },
    // Hardhat transaction hash from FairTicket.purchaseTicket
    mintTxHash: {
      type: String,
      required: true,
      trim: true,
      match: [BYTES32_HEX_REGEX, "must be a valid transaction hash"],
    },
    // Gate entry timestamp (required whenever status is USED)
    redeemedAt: {
      type: Date,
    },
    // GATE_STAFF user who verified and redeemed this ticket at the venue
    redeemedByStaffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    // Hardhat transaction hash from FairTicket.redeemTicket
    redeemTxHash: {
      type: String,
      trim: true,
      match: [BYTES32_HEX_REGEX, "must be a valid transaction hash"],
    },
    // Most recent Hardhat block number verified for this ticket record
    lastSyncedBlock: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: {
        validator: Number.isSafeInteger,
        message: "lastSyncedBlock must be a whole number",
      },
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

ticketSchema.pre("validate", function () {
  if (
    isValidPaise(this.originalPricePaise) &&
    this.maxResalePricePaise === undefined
  ) {
    this.maxResalePricePaise = calculateMaxResalePrice(this.originalPricePaise);
  }

  if (this.status === TICKET_STATUSES.USED && !this.redeemedAt) {
    this.invalidate(
      "redeemedAt",
      "redeemedAt must be set when ticket status is USED"
    );
  }
});

ticketSchema.index({ onChainTicketId: 1 }, { unique: true });
ticketSchema.index({ currentOwnerUserId: 1, status: 1 });
ticketSchema.index({ currentOwnerIdentityHash: 1, eventId: 1, status: 1 });
ticketSchema.index({ eventId: 1, status: 1 });
ticketSchema.index({ currentOwnerWallet: 1 });

module.exports = mongoose.model("Ticket", ticketSchema);
