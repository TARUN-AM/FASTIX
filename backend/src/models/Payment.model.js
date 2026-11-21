const mongoose = require("mongoose");
const {
  PAYMENT_TYPE_VALUES,
  PAYMENT_METHOD_VALUES,
  PAYMENT_STATUSES,
  PAYMENT_STATUS_VALUES,
} = require("../config/constants");
const { paiseSchemaValidator } = require("../utils/money");

const paymentSchema = new mongoose.Schema(
  {
    // Unique simulated payment gateway transaction reference (e.g. SIMPAY-920144)
    paymentReference: {
      type: String,
      required: true,
      trim: true,
      maxlength: 64,
    },
    // Distinguishes primary ticket checkout from official resale marketplace checkout
    paymentType: {
      type: String,
      required: true,
      enum: PAYMENT_TYPE_VALUES,
    },
    // User who initiated and paid for the transaction
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Event associated with this payment
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
      required: true,
    },
    // BookingHold reference populated when paymentType is PRIMARY_PURCHASE
    holdId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BookingHold",
    },
    // Resale listing reference populated when paymentType is RESALE_PURCHASE
    resaleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Resale",
    },
    // Exact amount charged stored as integer paise (min Rs 1.00 = 100 paise)
    amountPaise: {
      type: Number,
      required: true,
      min: 100,
      validate: paiseSchemaValidator,
    },
    // Currency code fixed to Indian Rupees (INR)
    currency: {
      type: String,
      required: true,
      enum: ["INR"],
      default: "INR",
    },
    // Simulated payment method selected in the demo UI
    method: {
      type: String,
      required: true,
      enum: PAYMENT_METHOD_VALUES,
    },
    // Payment lifecycle status (INITIATED, AUTHORIZED, SUCCEEDED, FAILED, REFUNDED)
    status: {
      type: String,
      required: true,
      enum: PAYMENT_STATUS_VALUES,
      default: PAYMENT_STATUSES.INITIATED,
    },
    // Client-supplied unique key preventing accidental double charges on retry
    idempotencyKey: {
      type: String,
      required: true,
      trim: true,
      minlength: 8,
      maxlength: 128,
    },
    // Timestamp when the simulated payment succeeded
    paidAt: {
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

paymentSchema.index({ paymentReference: 1 }, { unique: true });
paymentSchema.index({ idempotencyKey: 1 }, { unique: true });
paymentSchema.index({ userId: 1, createdAt: -1 });
paymentSchema.index({ holdId: 1 });
paymentSchema.index({ resaleId: 1 });

module.exports = mongoose.model("Payment", paymentSchema);
