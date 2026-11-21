const mongoose = require("mongoose");
const {
  RESALE_STATUSES,
  RESALE_STATUS_VALUES,
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

const resaleSchema = new mongoose.Schema(
  {
    // MongoDB Ticket document listed for official resale
    ticketId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ticket",
      required: true,
    },
    // Mirrors Tickets.onChainTicketId for direct contract lookups
    onChainTicketId: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isSafeInteger,
        message: "onChainTicketId must be a whole number",
      },
    },
    // Event reference used for marketplace filtering
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
      required: true,
    },
    // Verified current owner listing this ticket
    sellerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Lowercased MetaMask wallet of the seller
    sellerWallet: {
      type: String,
      required: true,
      set: walletAddressSetter,
      validate: walletAddressValidator,
    },
    // Original primary ticket price in integer paise for buyer transparency
    originalPricePaise: {
      type: Number,
      required: true,
      min: 100,
      validate: paiseSchemaValidator,
    },
    // Enforced 110% official resale cap in integer paise: floor(originalPricePaise * 110 / 100)
    maxAllowedPricePaise: {
      type: Number,
      required: true,
      min: 100,
      validate: paiseSchemaValidator,
    },
    // Official asking price in integer paise (must be <= 110% of originalPricePaise)
    askingPricePaise: {
      type: Number,
      required: true,
      min: 100,
      validate: [
        paiseSchemaValidator,
        {
          validator: function (value) {
            if (!isValidPaise(value) || !isValidPaise(this.originalPricePaise)) {
              return true;
            }
            return value <= calculateMaxResalePrice(this.originalPricePaise);
          },
          message:
            "askingPricePaise cannot exceed the 110% official resale cap",
        },
      ],
    },
    // Listing lifecycle status (ACTIVE, PAYMENT_LOCKED, SOLD, CANCELLED)
    status: {
      type: String,
      required: true,
      enum: RESALE_STATUS_VALUES,
      default: RESALE_STATUSES.ACTIVE,
    },
    // Buyer who temporarily locked this listing while completing simulated payment
    lockedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    // Short 3-minute checkout lock expiry preventing two buyers paying simultaneously
    lockExpiresAt: {
      type: Date,
    },
    // Final buyer account after official resale completes
    buyerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    // Lowercased wallet address of the final buyer
    buyerWallet: {
      type: String,
      set: walletAddressSetter,
      validate: walletAddressValidator,
    },
    // Confirmed simulated Payment record for this resale purchase
    paymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Payment",
    },
    // Single-use bytes32 nonce signed into the backend ECDSA permit for buyResaleTicket
    authNonce: {
      type: String,
      trim: true,
      match: [BYTES32_HEX_REGEX, "must be a 0x-prefixed 32-byte hex nonce"],
    },
    // Hardhat transaction hash from FairTicket.listForResale
    listTxHash: {
      type: String,
      required: true,
      trim: true,
      match: [BYTES32_HEX_REGEX, "must be a valid transaction hash"],
    },
    // Hardhat transaction hash from FairTicket.cancelResaleListing
    cancelTxHash: {
      type: String,
      trim: true,
      match: [BYTES32_HEX_REGEX, "must be a valid transaction hash"],
    },
    // Hardhat transaction hash from FairTicket.buyResaleTicket
    saleTxHash: {
      type: String,
      trim: true,
      match: [BYTES32_HEX_REGEX, "must be a valid transaction hash"],
    },
    // Timestamp when resale ownership transfer completed
    soldAt: {
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

resaleSchema.pre("validate", function () {
  if (isValidPaise(this.originalPricePaise)) {
    const computedMax = calculateMaxResalePrice(this.originalPricePaise);
    if (this.maxAllowedPricePaise === undefined) {
      this.maxAllowedPricePaise = computedMax;
    } else if (
      isValidPaise(this.maxAllowedPricePaise) &&
      this.maxAllowedPricePaise > computedMax
    ) {
      this.invalidate(
        "maxAllowedPricePaise",
        `maxAllowedPricePaise cannot exceed the 110% cap (${computedMax} paise)`
      );
    }
  }
});

// Enforces at most one open listing (ACTIVE or PAYMENT_LOCKED) per on-chain ticket.
resaleSchema.index(
  { onChainTicketId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: [RESALE_STATUSES.ACTIVE, RESALE_STATUSES.PAYMENT_LOCKED] },
    },
  }
);
// Enforces at most one ACTIVE listing per ticketId document.
resaleSchema.index(
  { ticketId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: RESALE_STATUSES.ACTIVE },
  }
);
resaleSchema.index({ eventId: 1, status: 1, askingPricePaise: 1 });
resaleSchema.index({ status: 1, createdAt: -1 });
resaleSchema.index(
  { authNonce: 1 },
  {
    unique: true,
    partialFilterExpression: { authNonce: { $type: "string" } },
  }
);

module.exports = mongoose.model("Resale", resaleSchema);
