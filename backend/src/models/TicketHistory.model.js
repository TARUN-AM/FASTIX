const mongoose = require("mongoose");
const { TICKET_HISTORY_ACTION_VALUES } = require("../config/constants");
const { paiseSchemaValidator } = require("../utils/money");
const {
  BYTES32_HEX_REGEX,
  walletAddressSetter,
  walletAddressValidator,
} = require("../utils/normalize");

const ticketHistorySchema = new mongoose.Schema(
  {
    // Target MongoDB Ticket document
    ticketId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ticket",
      required: true,
    },
    // Mirrors Tickets.onChainTicketId for on-chain event synchronization
    onChainTicketId: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isSafeInteger,
        message: "onChainTicketId must be a whole number",
      },
    },
    // Event associated with this ticket lifecycle record
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
      required: true,
    },
    // Lifecycle action recorded on-chain (MINTED, LISTED_FOR_RESALE, RESALE_CANCELLED, RESOLD, REDEEMED)
    action: {
      type: String,
      required: true,
      enum: TICKET_HISTORY_ACTION_VALUES,
    },
    // Previous owner wallet (0x0000...0000 for MINTED)
    fromWallet: {
      type: String,
      set: walletAddressSetter,
      validate: walletAddressValidator,
    },
    // New or current owner wallet receiving or holding the ticket
    toWallet: {
      type: String,
      set: walletAddressSetter,
      validate: walletAddressValidator,
    },
    // Sale or listing price in integer paise (0 for cancellations and gate redemptions)
    pricePaise: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: paiseSchemaValidator,
    },
    // Whole-number percentage price difference compared to original price (e.g. 10 for +10%)
    priceDeltaPercent: {
      type: Number,
      validate: {
        validator: (value) => value === undefined || Number.isSafeInteger(value),
        message: "priceDeltaPercent must be a whole integer percentage",
      },
    },
    // Hardhat transaction hash referencing the confirmed on-chain event
    txHash: {
      type: String,
      required: true,
      trim: true,
      match: [BYTES32_HEX_REGEX, "must be a valid transaction hash"],
    },
    // Hardhat block number in which the transaction was confirmed
    blockNumber: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isSafeInteger,
        message: "blockNumber must be a whole number",
      },
    },
    // Block timestamp when the on-chain transition occurred
    occurredAt: {
      type: Date,
      required: true,
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
  "TicketHistory is append-only and existing records cannot be modified or deleted.";

ticketHistorySchema.pre("save", function () {
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
  ticketHistorySchema.pre(hookName, { document: true, query: true }, function () {
    throw new Error(APPEND_ONLY_ERROR);
  });
}

for (const hookName of QUERY_ONLY_HOOKS) {
  ticketHistorySchema.pre(hookName, function () {
    throw new Error(APPEND_ONLY_ERROR);
  });
}

ticketHistorySchema.index(
  { onChainTicketId: 1, blockNumber: 1, action: 1, txHash: 1 },
  { unique: true }
);
ticketHistorySchema.index({ ticketId: 1, occurredAt: 1 });
ticketHistorySchema.index({ ticketId: 1, createdAt: 1 });

module.exports = mongoose.model("TicketHistory", ticketHistorySchema);
