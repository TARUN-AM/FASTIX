const crypto = require("crypto");
const express = require("express");
const request = require("supertest");

const app = require("../src/app");
const config = require("../src/config/env");
const constants = require("../src/config/constants");
const User = require("../src/models/User.model");
const VerificationRecord = require("../src/models/VerificationRecord.model");
const SecurityLog = require("../src/models/SecurityLog.model");
const { signAccessToken } = require("../src/utils/jwt");
const { validateOtp } = require("../src/utils/validators");
const otpService = require("../src/services/otp.service");
const smsProviderRegistry = require("../src/services/sms");
const mockSmsProvider = require("../src/services/sms/mockSmsProvider");
const consoleSmsProvider = require("../src/services/sms/consoleSmsProvider");
const { createVerificationRouter } = require("../src/routes/verification.routes");
const {
  createOtpVerifyLimiter,
} = require("../src/middleware/rateLimit.middleware");
const {
  notFoundHandler,
  errorHandler,
} = require("../src/middleware/errorHandler.middleware");
const {
  connectTestDb,
  clearTestDb,
  disconnectTestDb,
} = require("./helpers/db");

let userSeq = 0;

async function createCustomer(overrides = {}) {
  userSeq += 1;
  const user = await User.create({
    fullName: `Fan User ${userSeq}`,
    email: `otpfan${userSeq}@example.com`,
    phone: `+919876510${String(userSeq).padStart(3, "0")}`,
    passwordHash: "$2a$10$abcdefghijklmnopqrstuv1234567890abcdef",
    role: constants.USER_ROLES.CUSTOMER,
    phoneVerified: false,
    ...overrides,
  });
  return { user, token: signAccessToken(user) };
}

describe("Phone OTP Unit & Security Tests (No DB)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    mockSmsProvider.clearSentMessages();
  });

  test("generateOtp uses crypto.randomInt and preserves leading zeros", () => {
    const spy = jest.spyOn(crypto, "randomInt").mockReturnValue(7);
    expect(otpService.generateOtp(6)).toBe("000007");
    expect(spy).toHaveBeenCalledWith(0, 1000000);

    spy.mockRestore();
    const realCode = otpService.generateOtp(6);
    expect(realCode).toMatch(/^\d{6}$/);
  });

  test("hashOtp binds to userId and phone, and safeCompareHash handles different lengths safely", () => {
    const h1 = otpService.hashOtp({
      otp: "123456",
      userId: "507f1f77bcf86cd799439011",
      phone: "+919876543210",
    });
    const h2 = otpService.hashOtp({
      otp: "123456",
      userId: "507f1f77bcf86cd799439012",
      phone: "+919876543210",
    });
    const h3 = otpService.hashOtp({
      otp: "123456",
      userId: "507f1f77bcf86cd799439011",
      phone: "+919876543211",
    });

    expect(h1).toMatch(/^[a-f0-9]{64}$/);
    expect(h1).not.toBe(h2);
    expect(h1).not.toBe(h3);

    expect(otpService.safeCompareHash(h1, h1)).toBe(true);
    expect(otpService.safeCompareHash(h1, h2)).toBe(false);
    expect(otpService.safeCompareHash(h1, "short")).toBe(false);
    expect(otpService.safeCompareHash("", "")).toBe(false);
    expect(otpService.safeCompareHash(null, h1)).toBe(false);
  });

  test("maskPhone exposes only the last 4 digits", () => {
    expect(otpService.maskPhone("+919876543210")).toBe("+91******3210");
    expect(otpService.maskPhone("9876543210")).toBe("******3210");
    expect(otpService.maskPhone("+14155552671")).toBe("+1******2671");
    expect(otpService.maskPhone("1234")).toBe("****");
  });

  test("buildConfig forces DEMO_SHOW_OTP off in production with warning and validates OTP ranges", () => {
    const warnings = [];
    const baseEnv = {
      JWT_SECRET: "a".repeat(48),
      IDENTITY_HASH_SECRET: "b".repeat(48),
      SMS_PROVIDER: "console",
    };

    const devOff = config.buildConfig({ ...baseEnv, NODE_ENV: "development" });
    expect(devOff.otp.demoShowOtp).toBe(false);

    const devOn = config.buildConfig({
      ...baseEnv,
      NODE_ENV: "development",
      DEMO_SHOW_OTP: "true",
    });
    expect(devOn.otp.demoShowOtp).toBe(true);

    const prodForcedOff = config.buildConfig(
      { ...baseEnv, NODE_ENV: "production", DEMO_SHOW_OTP: "true" },
      { warn: (msg) => warnings.push(msg) }
    );
    expect(prodForcedOff.otp.demoShowOtp).toBe(false);
    expect(warnings.length).toBe(1);

    expect(() =>
      config.buildConfig({ ...baseEnv, OTP_LENGTH: "0" })
    ).toThrow();
    expect(() =>
      config.buildConfig({ ...baseEnv, SMS_PROVIDER: "twilio" })
    ).toThrow();
  });

  test("consoleSmsProvider never logs OTP in production and mockSmsProvider rejects production", async () => {
    const origEnv = process.env.NODE_ENV;
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    try {
      process.env.NODE_ENV = "production";
      await consoleSmsProvider.sendOtp({
        phone: "+919876543210",
        otp: "654321",
        expiresInSeconds: 300,
      });
      expect(logSpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
      expect(warnSpy.mock.calls.join(" ")).not.toContain("654321");

      await expect(
        mockSmsProvider.sendOtp({
          phone: "+919876543210",
          otp: "654321",
          expiresInSeconds: 300,
        })
      ).rejects.toThrow();
    } finally {
      process.env.NODE_ENV = origEnv;
    }
  });

  test("validateOtp rejects invalid formats and non-string payloads", () => {
    expect(validateOtp("012345", 6).valid).toBe(true);
    expect(validateOtp("12345", 6).valid).toBe(false);
    expect(validateOtp("1234567", 6).valid).toBe(false);
    expect(validateOtp("12ab56", 6).valid).toBe(false);
    expect(validateOtp(123456, 6).valid).toBe(false);
    expect(validateOtp({ $gt: "" }, 6).valid).toBe(false);
    expect(validateOtp(["123456"], 6).valid).toBe(false);
  });

  test("HTTP security without DB: unauthenticated OTP requests return 401 and verify rate limiter enforces 429", async () => {
    const unauthSend = await request(app).post(
      "/api/v1/verification/otp/request"
    );
    expect(unauthSend.status).toBe(401);
    expect(unauthSend.body.error.code).toBe(constants.ERROR_CODES.UNAUTHORIZED);

    const unauthVerify = await request(app)
      .post("/api/v1/verification/otp/verify")
      .send({ otpCode: "123456" });
    expect(unauthVerify.status).toBe(401);
    expect(unauthVerify.body.error.code).toBe(
      constants.ERROR_CODES.UNAUTHORIZED
    );

    // Verify rate limiter with tiny limit on isolated router
    const isolatedApp = express();
    isolatedApp.use(express.json());
    const limiter = createOtpVerifyLimiter({ max: 2, windowMs: 60 * 1000 });
    isolatedApp.post("/test-verify", limiter, (_req, res) =>
      res.status(200).json({ ok: true })
    );
    isolatedApp.use(notFoundHandler);
    isolatedApp.use(errorHandler);

    const r1 = await request(isolatedApp).post("/test-verify").send({});
    const r2 = await request(isolatedApp).post("/test-verify").send({});
    const r3 = await request(isolatedApp).post("/test-verify").send({});
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(429);
    expect(r3.body.error.code).toBe(constants.ERROR_CODES.RATE_LIMITED);
  });
});

describe("Phone OTP API & Atomicity Integration Tests (MongoDB)", () => {
  beforeAll(async () => {
    process.env.SMS_PROVIDER = "mock";
    await connectTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();
    mockSmsProvider.clearSentMessages();
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await disconnectTestDb();
  });

  test("Sending OTP delivers via mock SMS, never stores plaintext in DB, and blocks ADMIN and client-supplied phone", async () => {
    const { user, token } = await createCustomer();
    const { token: adminToken } = await createCustomer({
      role: constants.USER_ROLES.ADMIN,
    });

    const adminRes = await request(app)
      .post("/api/v1/verification/otp/request")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(adminRes.status).toBe(403);
    expect(adminRes.body.error.code).toBe(constants.ERROR_CODES.FORBIDDEN);

    const bodyPhoneRes = await request(app)
      .post("/api/v1/verification/otp/request")
      .set("Authorization", `Bearer ${token}`)
      .send({ phone: "+919999999999" });
    expect(bodyPhoneRes.status).toBe(400);
    expect(bodyPhoneRes.body.error.code).toBe(
      constants.ERROR_CODES.VALIDATION_ERROR
    );

    const sendRes = await request(app)
      .post("/api/v1/verification/otp/request")
      .set("Authorization", `Bearer ${token}`)
      .send({});

    expect(sendRes.status).toBe(200);
    expect(sendRes.body.success).toBe(true);
    expect(sendRes.body.data.maskedPhone).toBe(otpService.maskPhone(user.phone));
    expect(sendRes.body.data.demoOtp).toBeUndefined();

    const messages = mockSmsProvider.getSentMessages();
    expect(messages.length).toBe(1);
    const plainOtp = messages[0].otp;
    expect(plainOtp).toMatch(new RegExp(`^\\d{${config.otp.length}}$`));

    const storedRecord = await VerificationRecord.findOne({
      userId: user._id,
      verificationType: constants.VERIFICATION_TYPES.PHONE_OTP,
    })
      .select("+otpHash")
      .lean();
    const storedUser = await User.findById(user._id).lean();

    expect(storedRecord).not.toBeNull();
    expect(storedRecord.otpHash).toMatch(/^[a-f0-9]{64}$/);
    expect(storedRecord.otpHash).not.toBe(plainOtp);
    expect(JSON.stringify(storedRecord)).not.toContain(plainOtp);
    expect(JSON.stringify(storedUser)).not.toContain(plainOtp);
  });

  test("Cooldown, code replacement, hourly send limit, concurrent sends, and SMS failure rollback", async () => {
    const { user, token } = await createCustomer();

    // Concurrent send race -> exactly one 200 and one 429 OTP_COOLDOWN
    const [s1, s2] = await Promise.all([
      request(app)
        .post("/api/v1/verification/otp/request")
        .set("Authorization", `Bearer ${token}`)
        .send({}),
      request(app)
        .post("/api/v1/verification/otp/request")
        .set("Authorization", `Bearer ${token}`)
        .send({}),
    ]);

    const raceStatuses = [s1.status, s2.status].sort();
    expect(raceStatuses).toEqual([200, 429]);
    const cooldownResp = s1.status === 429 ? s1 : s2;
    expect(cooldownResp.body.error.code).toBe(constants.ERROR_CODES.OTP_COOLDOWN);
    expect(cooldownResp.body.error.details.retryAfterSeconds).toBeGreaterThan(0);

    const firstOtp = mockSmsProvider.getSentMessages()[0].otp;

    // Move otpLastSentAt back past cooldown -> second send succeeds & invalidates first OTP
    await VerificationRecord.updateOne(
      {
        userId: user._id,
        verificationType: constants.VERIFICATION_TYPES.PHONE_OTP,
      },
      {
        $set: {
          otpLastSentAt: new Date(
            Date.now() - (config.otp.resendCooldownSeconds + 5) * 1000
          ),
        },
      }
    );

    const secondSend = await request(app)
      .post("/api/v1/verification/otp/request")
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(secondSend.status).toBe(200);

    // Exhaust remaining hourly send quota
    for (let i = 2; i < config.otp.maxSendsPerHour; i += 1) {
      await VerificationRecord.updateOne(
        {
          userId: user._id,
          verificationType: constants.VERIFICATION_TYPES.PHONE_OTP,
        },
        {
          $set: {
            otpLastSentAt: new Date(
              Date.now() - (config.otp.resendCooldownSeconds + 5) * 1000
            ),
          },
        }
      );
      const r = await request(app)
        .post("/api/v1/verification/otp/request")
        .set("Authorization", `Bearer ${token}`)
        .send({});
      expect(r.status).toBe(200);
    }

    // Move past cooldown once more -> hourly send limit must trigger
    await VerificationRecord.updateOne(
      {
        userId: user._id,
        verificationType: constants.VERIFICATION_TYPES.PHONE_OTP,
      },
      {
        $set: {
          otpLastSentAt: new Date(
            Date.now() - (config.otp.resendCooldownSeconds + 5) * 1000
          ),
        },
      }
    );
    const limitHit = await request(app)
      .post("/api/v1/verification/otp/request")
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(limitHit.status).toBe(429);
    expect(limitHit.body.error.code).toBe(constants.ERROR_CODES.OTP_SEND_LIMIT);

    // First OTP must no longer verify
    const oldVerify = await request(app)
      .post("/api/v1/verification/otp/verify")
      .set("Authorization", `Bearer ${token}`)
      .send({ otpCode: firstOtp });
    expect(oldVerify.status).toBe(400);
    expect(oldVerify.body.error.code).toBe(constants.ERROR_CODES.OTP_INVALID);

    // Failing SMS provider on fresh user -> 502 SMS_FAILED and NOT stuck in cooldown
    const { token: freshToken } = await createCustomer();
    const failSpy = jest
      .spyOn(smsProviderRegistry, "getSmsProvider")
      .mockReturnValueOnce({
        providerName: "BROKEN_SMS",
        sendOtp: async () => {
          throw new Error("Gateway down");
        },
      });

    const failedSend = await request(app)
      .post("/api/v1/verification/otp/request")
      .set("Authorization", `Bearer ${freshToken}`)
      .send({});
    expect(failedSend.status).toBe(502);
    expect(failedSend.body.error.code).toBe(constants.ERROR_CODES.SMS_FAILED);
    failSpy.mockRestore();

    const immediateRetry = await request(app)
      .post("/api/v1/verification/otp/request")
      .set("Authorization", `Bearer ${freshToken}`)
      .send({});
    expect(immediateRetry.status).toBe(200);
  });

  test("Verification enforces attempts lockout, expiry, single-use race, user isolation, payload validation, and clean SecurityLogs", async () => {
    const { user: userA, token: tokenA } = await createCustomer();
    const { token: tokenB } = await createCustomer();

    // Verify before requesting any OTP -> OTP_NOT_REQUESTED
    const beforeReq = await request(app)
      .post("/api/v1/verification/otp/verify")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ otpCode: "123456" });
    expect(beforeReq.status).toBe(400);
    expect(beforeReq.body.error.code).toBe(
      constants.ERROR_CODES.OTP_NOT_REQUESTED
    );

    // Invalid payload types return 400 VALIDATION_ERROR without crashing
    for (const badOtp of [123456, { $gt: "" }, ["123456"], "12345", "12ab56"]) {
      const badRes = await request(app)
        .post("/api/v1/verification/otp/verify")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ otpCode: badOtp });
      expect(badRes.status).toBe(400);
      expect(badRes.body.error.code).toBe(
        constants.ERROR_CODES.VALIDATION_ERROR
      );
    }

    // Request OTP for User A and User B
    await request(app)
      .post("/api/v1/verification/otp/request")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({});
    const otpA = mockSmsProvider.getSentMessages()[0].otp;

    await request(app)
      .post("/api/v1/verification/otp/request")
      .set("Authorization", `Bearer ${tokenB}`)
      .send({});

    // User A's code must NOT verify for User B
    const wrongUserRes = await request(app)
      .post("/api/v1/verification/otp/verify")
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ otpCode: otpA });
    expect(wrongUserRes.status).toBe(400);
    expect(wrongUserRes.body.error.code).toBe(constants.ERROR_CODES.OTP_INVALID);

    // Wrong OTP decrements attemptsRemaining until OTP_MAX_ATTEMPTS locks even the right code
    const wrongCode = otpA === "000000" ? "111111" : "000000";
    for (let i = 1; i < config.otp.maxAttempts; i += 1) {
      const wrongTry = await request(app)
        .post("/api/v1/verification/otp/verify")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ otpCode: wrongCode });
      expect(wrongTry.status).toBe(400);
      expect(wrongTry.body.error.code).toBe(constants.ERROR_CODES.OTP_INVALID);
      expect(wrongTry.body.error.details.attemptsRemaining).toBe(
        config.otp.maxAttempts - i
      );
    }

    const lockingTry = await request(app)
      .post("/api/v1/verification/otp/verify")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ otpCode: wrongCode });
    expect(lockingTry.status).toBe(429);
    expect(lockingTry.body.error.code).toBe(
      constants.ERROR_CODES.OTP_MAX_ATTEMPTS
    );

    // Even correct OTP is now rejected until a new code is requested
    const rightAfterLock = await request(app)
      .post("/api/v1/verification/otp/verify")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ otpCode: otpA });
    expect(rightAfterLock.status).toBe(429);
    expect(rightAfterLock.body.error.code).toBe(
      constants.ERROR_CODES.OTP_MAX_ATTEMPTS
    );

    // Expire check: move otpLastSentAt back, send new code, expire it, expect OTP_EXPIRED
    await VerificationRecord.updateOne(
      {
        userId: userA._id,
        verificationType: constants.VERIFICATION_TYPES.PHONE_OTP,
      },
      {
        $set: {
          otpLastSentAt: new Date(
            Date.now() - (config.otp.resendCooldownSeconds + 5) * 1000
          ),
        },
      }
    );
    await request(app)
      .post("/api/v1/verification/otp/request")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({});
    const expiredOtp =
      mockSmsProvider.getSentMessages()[
        mockSmsProvider.getSentMessages().length - 1
      ].otp;

    await VerificationRecord.updateOne(
      {
        userId: userA._id,
        verificationType: constants.VERIFICATION_TYPES.PHONE_OTP,
      },
      { $set: { otpExpiresAt: new Date(Date.now() - 1000) } }
    );
    const expiredRes = await request(app)
      .post("/api/v1/verification/otp/verify")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ otpCode: expiredOtp });
    expect(expiredRes.status).toBe(400);
    expect(expiredRes.body.error.code).toBe(constants.ERROR_CODES.OTP_EXPIRED);

    // Request fresh OTP and fire two simultaneous verifies -> exactly ONE 200
    await VerificationRecord.updateOne(
      {
        userId: userA._id,
        verificationType: constants.VERIFICATION_TYPES.PHONE_OTP,
      },
      {
        $set: {
          otpLastSentAt: new Date(
            Date.now() - (config.otp.resendCooldownSeconds + 5) * 1000
          ),
        },
      }
    );
    await request(app)
      .post("/api/v1/verification/otp/request")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({});
    const finalOtp =
      mockSmsProvider.getSentMessages()[
        mockSmsProvider.getSentMessages().length - 1
      ].otp;

    const [v1, v2] = await Promise.all([
      request(app)
        .post("/api/v1/verification/otp/verify")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ otpCode: finalOtp }),
      request(app)
        .post("/api/v1/verification/otp/verify")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ otpCode: finalOtp }),
    ]);

    const verifyStatuses = [v1.status, v2.status];
    expect(verifyStatuses.filter((s) => s === 200).length).toBe(1);

    // GET /verification/status reflects phone verified + masked phone
    const statusRes = await request(app)
      .get("/api/v1/verification/status")
      .set("Authorization", `Bearer ${tokenA}`);
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.data.phoneVerified).toBe(true);
    expect(statusRes.body.data.phone.verified).toBe(true);
    expect(statusRes.body.data.phone.maskedPhone).toBe(
      otpService.maskPhone(userA.phone)
    );

    // Already verified phone -> send and verify both return 409 PHONE_ALREADY_VERIFIED
    const sendAgain = await request(app)
      .post("/api/v1/verification/otp/request")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({});
    expect(sendAgain.status).toBe(409);
    expect(sendAgain.body.error.code).toBe(
      constants.ERROR_CODES.PHONE_ALREADY_VERIFIED
    );

    const verifyAgain = await request(app)
      .post("/api/v1/verification/otp/verify")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ otpCode: finalOtp });
    expect(verifyAgain.status).toBe(409);
    expect(verifyAgain.body.error.code).toBe(
      constants.ERROR_CODES.PHONE_ALREADY_VERIFIED
    );

    // SecurityLogs contain sent, failed, brute force, verified — and NEVER plaintext OTP, hash, or raw phone
    const logs = await SecurityLog.find({ userId: userA._id }).lean();
    const types = logs.map((l) => l.eventType);
    expect(types).toEqual(
      expect.arrayContaining([
        constants.SECURITY_EVENT_TYPES.OTP_SENT,
        constants.SECURITY_EVENT_TYPES.OTP_FAILED,
        constants.SECURITY_EVENT_TYPES.OTP_BRUTE_FORCE,
        constants.SECURITY_EVENT_TYPES.OTP_VERIFIED,
      ])
    );

    const logsJson = JSON.stringify(logs);
    expect(logsJson).not.toContain(otpA);
    expect(logsJson).not.toContain(finalOtp);
    expect(logsJson).not.toContain(userA.phone);

    // Verify router-level verify rate limiter returns 429 on tiny limit
    const rateApp = express();
    rateApp.use(express.json());
    rateApp.use(
      "/api/v1/verification",
      createVerificationRouter({
        otpVerifyLimiter: createOtpVerifyLimiter({ max: 1, windowMs: 60000 }),
      })
    );
    rateApp.use(notFoundHandler);
    rateApp.use(errorHandler);

    const rl1 = await request(rateApp)
      .post("/api/v1/verification/otp/verify")
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ otpCode: "000000" });
    const rl2 = await request(rateApp)
      .post("/api/v1/verification/otp/verify")
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ otpCode: "000000" });
    expect(rl1.status).toBe(400);
    expect(rl2.status).toBe(429);
    expect(rl2.body.error.code).toBe(constants.ERROR_CODES.RATE_LIMITED);
  });
});
