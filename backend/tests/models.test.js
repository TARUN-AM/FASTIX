process.env.NODE_ENV = "test";
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  process.env.JWT_SECRET =
    "test_only_jwt_secret_key_for_fairticket_models_test_suite_123456";
}

const mongoose = require("mongoose");
const constants = require("../src/config/constants");
const {
  isValidPaise,
  calculateMaxResalePrice,
  isScalpingPrice,
  formatRupees,
} = require("../src/utils/money");
const {
  normalizeEmail,
  normalizePhone,
  normalizeWalletAddress,
} = require("../src/utils/normalize");

const User = require("../src/models/User.model");
const VerificationRecord = require("../src/models/VerificationRecord.model");
const Event = require("../src/models/Event.model");
const QueueEntry = require("../src/models/QueueEntry.model");
const BookingHold = require("../src/models/BookingHold.model");
const Booking = require("../src/models/Booking.model");
const Payment = require("../src/models/Payment.model");
const Ticket = require("../src/models/Ticket.model");
const Resale = require("../src/models/Resale.model");
const TicketHistory = require("../src/models/TicketHistory.model");
const SecurityLog = require("../src/models/SecurityLog.model");

const SAMPLE_HASH =
  "0x1111111111111111111111111111111111111111111111111111111111111111";
const SAMPLE_TX_HASH =
  "0x2222222222222222222222222222222222222222222222222222222222222222";
const SAMPLE_WALLET = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const SAMPLE_WALLET_LOWER = SAMPLE_WALLET.toLowerCase();

describe("Constants, Money Math, and Normalizers", () => {
  test("Numeric constants match ARCHITECTURE.md section 2", () => {
    expect(constants.MAX_ACTIVE_TICKETS).toBe(2);
    expect(constants.RESALE_CAP_PERCENT).toBe(110);
    expect(constants.SCALPING_WARNING_MULTIPLIER).toBe(5);
    expect(constants.DEFAULT_HOLD_MINUTES).toBe(5);
    expect(constants.QR_TOKEN_TTL_SECONDS).toBe(30);
    expect(Object.isFrozen(constants)).toBe(true);
    expect(Object.isFrozen(constants.USER_ROLES)).toBe(true);
    expect(Object.isFrozen(constants.USER_ROLE_VALUES)).toBe(true);
  });

  test("Integer paise helpers enforce integer math and exact 110% cap", () => {
    expect(isValidPaise(0)).toBe(true);
    expect(isValidPaise(500000)).toBe(true);
    expect(isValidPaise(-1)).toBe(false);
    expect(isValidPaise(5000.5)).toBe(false);
    expect(isValidPaise("500000")).toBe(false);
    expect(isValidPaise(NaN)).toBe(false);

    expect(calculateMaxResalePrice(500000)).toBe(550000);
    expect(calculateMaxResalePrice(101)).toBe(111); // floor(101 * 110 / 100) = 111
    expect(() => calculateMaxResalePrice(100.5)).toThrow();
    expect(() => calculateMaxResalePrice(-100)).toThrow();

    expect(isScalpingPrice(500000, 2500000)).toBe(true);
    expect(isScalpingPrice(500000, 2499999)).toBe(false);

    expect(formatRupees(500000)).toBe("Rs 5,000.00");
    expect(formatRupees(550005)).toBe("Rs 5,500.05");
  });

  test("Normalization helpers clean email, phone, and wallet addresses", () => {
    expect(normalizeEmail("  Fan.User@Example.COM ")).toBe(
      "fan.user@example.com"
    );
    expect(normalizePhone(" +91 98765-43210 ")).toBe("+919876543210");
    expect(normalizePhone(" 98765 43210 ")).toBe("9876543210");
    expect(normalizeWalletAddress(SAMPLE_WALLET)).toBe(SAMPLE_WALLET_LOWER);
    expect(() => normalizeWalletAddress("0x1234")).toThrow();
    expect(() => normalizeWalletAddress("not-a-wallet")).toThrow();
  });
});

describe("Mongoose Models Schema Validation & Special Rules", () => {
  const oid = () => new mongoose.Types.ObjectId();

  test("User normalizes fields, hides sensitive fields in toJSON, and defines partial unique indexes", async () => {
    const user = new User({
      fullName: "Aarav Sharma",
      email: "  AARAV@Example.com ",
      phone: " +91 98765-43210 ",
      passwordHash: "$2a$10$abcdefghijklmnopqrstuv1234567890abcdef",
      walletAddress: SAMPLE_WALLET,
      walletAuthNonce: "secret-nonce-123",
    });

    await expect(user.validate()).resolves.toBeUndefined();
    expect(user.email).toBe("aarav@example.com");
    expect(user.phone).toBe("+919876543210");
    expect(user.walletAddress).toBe(SAMPLE_WALLET_LOWER);

    const json = user.toJSON();
    expect(json.passwordHash).toBeUndefined();
    expect(json.walletAuthNonce).toBeUndefined();
    expect(json.__v).toBeUndefined();
    expect(User.schema.path("passwordHash").options.select).toBe(false);

    const indexes = User.schema.indexes();
    const walletIdx = indexes.find(([fields]) => fields.walletAddress === 1);
    const idHashIdx = indexes.find(([fields]) => fields.identityHash === 1);
    expect(walletIdx[1]).toMatchObject({
      unique: true,
      partialFilterExpression: { walletAddress: { $type: "string" } },
    });
    expect(idHashIdx[1]).toMatchObject({
      unique: true,
      partialFilterExpression: { identityHash: { $type: "string" } },
    });
  });

  test("VerificationRecord hides otpHash in select and toJSON", async () => {
    const rec = new VerificationRecord({
      userId: oid(),
      verificationType: constants.VERIFICATION_TYPES.PHONE_OTP,
      otpHash: "sha256-salted-hash-value",
    });
    await expect(rec.validate()).resolves.toBeUndefined();
    expect(VerificationRecord.schema.path("otpHash").options.select).toBe(
      false
    );
    expect(rec.toJSON().otpHash).toBeUndefined();
  });

  test("Event validates holdDurationMinutes (1..15), integer paise, and auto-calculates 110% cap", async () => {
    const now = new Date();
    const validEvent = new Event({
      onChainEventId: 1,
      organizerId: oid(),
      title: "Coldplay Mumbai",
      artist: "Coldplay",
      category: constants.EVENT_CATEGORIES.CONCERT,
      description: "Live stadium concert in Mumbai with verified fair tickets.",
      venueName: "DY Patil Stadium",
      city: "Mumbai",
      eventDate: new Date(now.getTime() + 86400000 * 10),
      registrationOpenAt: now,
      registrationCloseAt: new Date(now.getTime() + 3600000),
      totalTickets: 500,
      availableTickets: 500,
      basePricePaise: 500000,
      holdDurationMinutes: 5,
    });

    await expect(validEvent.validate()).resolves.toBeUndefined();
    expect(validEvent.maxResalePricePaise).toBe(550000);

    const badHoldLow = new Event({ ...validEvent.toObject(), holdDurationMinutes: 0 });
    await expect(badHoldLow.validate()).rejects.toThrow(/holdDurationMinutes/);

    const badHoldHigh = new Event({ ...validEvent.toObject(), holdDurationMinutes: 16 });
    await expect(badHoldHigh.validate()).rejects.toThrow(/holdDurationMinutes/);

    const badFloatPrice = new Event({ ...validEvent.toObject(), basePricePaise: 5000.5 });
    await expect(badFloatPrice.validate()).rejects.toThrow(/whole number of paise/);
  });

  test("QueueEntry, BookingHold, Booking, and Payment validate cleanly and declare required indexes", async () => {
    const now = new Date();
    const qe = new QueueEntry({
      eventId: oid(),
      userId: oid(),
      identityHash: SAMPLE_HASH,
    });
    await expect(qe.validate()).resolves.toBeUndefined();

    const hold = new BookingHold({
      eventId: oid(),
      userId: oid(),
      identityHash: SAMPLE_HASH,
      queueEntryId: qe._id,
      quantity: 2,
      unitPricePaise: 500000,
      totalPricePaise: 1000000,
      startedAt: now,
      expiresAt: new Date(now.getTime() + 300000),
    });
    await expect(hold.validate()).resolves.toBeUndefined();

    const holdPartialIdx = BookingHold.schema
      .indexes()
      .find(([fields, opts]) => fields.eventId === 1 && fields.userId === 1 && opts.unique);
    expect(holdPartialIdx[1].partialFilterExpression).toEqual({
      status: constants.BOOKING_HOLD_STATUSES.ACTIVE,
    });

    const payment = new Payment({
      paymentReference: "SIMPAY-100001",
      paymentType: constants.PAYMENT_TYPES.PRIMARY_PURCHASE,
      userId: hold.userId,
      eventId: hold.eventId,
      holdId: hold._id,
      amountPaise: 1000000,
      method: constants.PAYMENT_METHODS.SIMULATED_UPI,
      idempotencyKey: "idem-key-12345678",
    });
    await expect(payment.validate()).resolves.toBeUndefined();

    const booking = new Booking({
      bookingReference: "FT-2026-100001",
      eventId: hold.eventId,
      userId: hold.userId,
      identityHash: SAMPLE_HASH,
      walletAddress: SAMPLE_WALLET,
      holdId: hold._id,
      paymentId: payment._id,
      quantity: 2,
      totalAmountPaise: 1000000,
      authNonce: SAMPLE_HASH,
      authExpiry: Math.floor(Date.now() / 1000) + 180,
    });
    await expect(booking.validate()).resolves.toBeUndefined();
  });

  test("Ticket enforces redeemedAt when status is USED", async () => {
    const baseTicket = {
      onChainTicketId: 1,
      eventId: oid(),
      onChainEventId: 1,
      bookingId: oid(),
      originalBuyerUserId: oid(),
      originalOwnerWallet: SAMPLE_WALLET,
      currentOwnerUserId: oid(),
      currentOwnerWallet: SAMPLE_WALLET,
      currentOwnerIdentityHash: SAMPLE_HASH,
      originalPricePaise: 500000,
      lastSalePricePaise: 500000,
      mintTxHash: SAMPLE_TX_HASH,
    };

    const usedWithoutDate = new Ticket({
      ...baseTicket,
      status: constants.TICKET_STATUSES.USED,
    });
    await expect(usedWithoutDate.validate()).rejects.toThrow(/redeemedAt/);

    const usedWithDate = new Ticket({
      ...baseTicket,
      status: constants.TICKET_STATUSES.USED,
      redeemedAt: new Date(),
    });
    await expect(usedWithDate.validate()).resolves.toBeUndefined();
    expect(usedWithDate.maxResalePricePaise).toBe(550000);
  });

  test("Resale enforces 110% integer cap while SecurityLog accepts 5x attempted scalping prices", async () => {
    const baseResale = {
      ticketId: oid(),
      onChainTicketId: 1,
      eventId: oid(),
      sellerUserId: oid(),
      sellerWallet: SAMPLE_WALLET,
      originalPricePaise: 500000,
      askingPricePaise: 550000,
      listTxHash: SAMPLE_TX_HASH,
    };

    const validResale = new Resale(baseResale);
    await expect(validResale.validate()).resolves.toBeUndefined();
    expect(validResale.maxAllowedPricePaise).toBe(550000);

    const overCapResale = new Resale({
      ...baseResale,
      askingPricePaise: 550001,
    });
    await expect(overCapResale.validate()).rejects.toThrow(/110% official resale cap/);

    const scalpingLog = new SecurityLog({
      eventType: constants.SECURITY_EVENT_TYPES.SCALPING_ATTEMPT_5X,
      severity: constants.SECURITY_SEVERITIES.CRITICAL,
      userId: oid(),
      walletAddress: SAMPLE_WALLET,
      attemptedPricePaise: 2500000,
      allowedMaxPricePaise: 550000,
      details: { multiplier: 5 },
    });
    await expect(scalpingLog.validate()).resolves.toBeUndefined();
  });

  test("TicketHistory and SecurityLog block all append-only mutations via Mongoose middleware", async () => {
    const historyDoc = new TicketHistory({
      ticketId: oid(),
      onChainTicketId: 1,
      eventId: oid(),
      action: constants.TICKET_HISTORY_ACTIONS.MINTED,
      toWallet: SAMPLE_WALLET,
      pricePaise: 500000,
      txHash: SAMPLE_TX_HASH,
      blockNumber: 1,
      occurredAt: new Date(),
    });
    await expect(historyDoc.validate()).resolves.toBeUndefined();

    // Simulate an already-persisted document attempting save()
    historyDoc.isNew = false;
    await expect(historyDoc.save()).rejects.toThrow(/append-only/i);

    await expect(TicketHistory.updateOne({}, { pricePaise: 100 })).rejects.toThrow(/append-only/i);
    await expect(TicketHistory.updateMany({}, { pricePaise: 100 })).rejects.toThrow(/append-only/i);
    await expect(TicketHistory.findOneAndUpdate({}, { pricePaise: 100 })).rejects.toThrow(/append-only/i);
    await expect(TicketHistory.findOneAndDelete({})).rejects.toThrow(/append-only/i);
    await expect(TicketHistory.deleteOne({})).rejects.toThrow(/append-only/i);
    await expect(TicketHistory.deleteMany({})).rejects.toThrow(/append-only/i);
    await expect(TicketHistory.replaceOne({}, {})).rejects.toThrow(/append-only/i);

    const logDoc = new SecurityLog({
      eventType: constants.SECURITY_EVENT_TYPES.RESALE_CAP_VIOLATION,
      severity: constants.SECURITY_SEVERITIES.HIGH,
      details: { reason: "Over 110% cap" },
    });
    await expect(logDoc.validate()).resolves.toBeUndefined();

    logDoc.isNew = false;
    await expect(logDoc.save()).rejects.toThrow(/append-only/i);

    await expect(SecurityLog.updateOne({}, { severity: "LOW" })).rejects.toThrow(/append-only/i);
    await expect(SecurityLog.updateMany({}, { severity: "LOW" })).rejects.toThrow(/append-only/i);
    await expect(SecurityLog.findOneAndUpdate({}, { severity: "LOW" })).rejects.toThrow(/append-only/i);
    await expect(SecurityLog.findOneAndDelete({})).rejects.toThrow(/append-only/i);
    await expect(SecurityLog.deleteOne({})).rejects.toThrow(/append-only/i);
    await expect(SecurityLog.deleteMany({})).rejects.toThrow(/append-only/i);
    await expect(SecurityLog.replaceOne({}, {})).rejects.toThrow(/append-only/i);
  });
});
