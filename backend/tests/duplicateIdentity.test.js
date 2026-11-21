const express = require("express");
const mongoose = require("mongoose");
const request = require("supertest");

const app = require("../src/app");
const config = require("../src/config/env");
const constants = require("../src/config/constants");
const User = require("../src/models/User.model");
const VerificationRecord = require("../src/models/VerificationRecord.model");
const SecurityLog = require("../src/models/SecurityLog.model");
const { signAccessToken } = require("../src/utils/jwt");
const { normalizeDocumentNumber } = require("../src/utils/normalize");
const {
  looksLikeRealId,
  validateDemoDocumentNumber,
} = require("../src/utils/validators");
const { computeIdentityHash } = require("../src/utils/identityHash");
const duplicateIdentityService = require("../src/services/duplicateIdentity.service");
const { authenticate } = require("../src/middleware/auth.middleware");
const { requireRole } = require("../src/middleware/role.middleware");
const {
  requireVerifiedUser,
  resetUnverifiedLogCache,
} = require("../src/middleware/verifiedUser.middleware");
const {
  notFoundHandler,
  errorHandler,
} = require("../src/middleware/errorHandler.middleware");
const {
  checkIdentityIntegrity,
} = require("../scripts/checkIdentityIntegrity");
const {
  connectTestDb,
  clearTestDb,
  disconnectTestDb,
} = require("./helpers/db");

let userSeq = 0;

async function createCustomerWithVerifiedPhone(overrides = {}) {
  userSeq += 1;
  const user = await User.create({
    fullName: `Fan User ${userSeq}`,
    email: `dup.fan${userSeq}@example.com`,
    phone: `+919876600${String(userSeq).padStart(3, "0")}`,
    passwordHash: "$2a$10$abcdefghijklmnopqrstuv1234567890abcdef",
    role: constants.USER_ROLES.CUSTOMER,
    phoneVerified: true,
    ...overrides,
  });
  const token = signAccessToken(user);
  return { user, token };
}

function buildVerifiedGateTestApp(options = { requireWallet: false }) {
  const testApp = express();
  testApp.use(express.json());
  testApp.get(
    "/api/v1/test-protected/queue",
    authenticate,
    requireRole(constants.USER_ROLES.CUSTOMER),
    requireVerifiedUser(options),
    (req, res) => {
      res.status(200).json({
        success: true,
        data: { allowed: true, userId: String(req.user._id) },
        error: null,
      });
    }
  );
  testApp.use(notFoundHandler);
  testApp.use(errorHandler);
  return testApp;
}

describe("Duplicate Identity & Gate Unit Tests (No DB)", () => {
  test("normalizeDocumentNumber maps full-width, zero-width, and NBSP variants to identical ASCII", () => {
    const plain = "DEMO-ABC12345";
    const fullWidth = "ＤＥＭＯ-ＡＢＣ１２３４５";
    const zeroWidth = "DEMO-\u200BABC\u200C123\u200D45\uFEFF";
    const nbspAndLower = " \u00A0demo-\u00A0abc 12345\u3000 ";

    expect(normalizeDocumentNumber(fullWidth)).toBe(plain);
    expect(normalizeDocumentNumber(zeroWidth)).toBe(plain);
    expect(normalizeDocumentNumber(nbspAndLower)).toBe(plain);

    const hashPlain = computeIdentityHash({
      documentType: "DEMO_ID",
      documentNumber: plain,
    });
    const hashFullWidth = computeIdentityHash({
      documentType: "DEMO_ID",
      documentNumber: fullWidth,
    });
    const hashZeroWidth = computeIdentityHash({
      documentType: "DEMO_ID",
      documentNumber: zeroWidth,
    });

    expect(hashFullWidth).toBe(hashPlain);
    expect(hashZeroWidth).toBe(hashPlain);
  });

  test("Cyrillic look-alike characters are rejected by validateDemoDocumentNumber (ASCII-only)", () => {
    // U+0410 CYRILLIC CAPITAL LETTER A
    const cyrillicLookalike = "DEMO-\u0410BC12345";
    const result = validateDemoDocumentNumber(cyrillicLookalike);
    expect(result.valid).toBe(false);
  });

  test("looksLikeRealId detects full-width 12-digit Aadhaar-like and PAN-like values", () => {
    expect(looksLikeRealId("１２３４ ５６７８ ９０１２")).toBe(true);
    expect(looksLikeRealId("１２３４５６７８９０１２")).toBe(true);
    expect(looksLikeRealId("1234\u200B5678\uFEFF9012")).toBe(true);
    expect(looksLikeRealId("ＡＢＣＤＥ１２３４Ｆ")).toBe(true);
    expect(looksLikeRealId("DEMO-ABC12345")).toBe(false);
    expect(looksLikeRealId("ＤＥＭＯ-ＡＢＣ１２３４５")).toBe(false);
  });

  test("buildConfig defaults IDENTITY_DUPLICATE_FLAG_THRESHOLD to 3 and rejects invalid values", () => {
    const baseEnv = {
      NODE_ENV: "test",
      JWT_SECRET: "a".repeat(48),
      IDENTITY_HASH_SECRET: "b".repeat(48),
    };

    const defaults = config.buildConfig(baseEnv);
    expect(defaults.identityDuplicateFlagThreshold).toBe(3);

    expect(
      config.buildConfig({ ...baseEnv, IDENTITY_DUPLICATE_FLAG_THRESHOLD: "1" })
        .identityDuplicateFlagThreshold
    ).toBe(1);
    expect(
      config.buildConfig({
        ...baseEnv,
        IDENTITY_DUPLICATE_FLAG_THRESHOLD: "20",
      }).identityDuplicateFlagThreshold
    ).toBe(20);

    for (const bad of ["0", "-1", "2.5", "abc", "21"]) {
      expect(() =>
        config.buildConfig({
          ...baseEnv,
          IDENTITY_DUPLICATE_FLAG_THRESHOLD: bad,
        })
      ).toThrow(/IDENTITY_DUPLICATE_FLAG_THRESHOLD/i);
    }
  });

  test("requireVerifiedUser middleware enforces phone -> identity -> optional wallet order without DB", async () => {
    const runGuard = async (user, options) => {
      const guard = requireVerifiedUser(options);
      let nextCalled = false;
      let statusCode = null;
      let body = null;
      const req = {
        user,
        method: "GET",
        path: "/queue",
        baseUrl: "/api/v1/test",
        ip: "127.0.0.1",
        headers: {},
      };
      const res = {
        status(code) {
          statusCode = code;
          return this;
        },
        json(payload) {
          body = payload;
          return this;
        },
      };
      await guard(req, res, () => {
        nextCalled = true;
      });
      return { nextCalled, statusCode, body };
    };

    const unverifiedPhone = await runGuard(
      { _id: new mongoose.Types.ObjectId(), phoneVerified: false, identityStatus: "NOT_STARTED" },
      { requireWallet: false }
    );
    expect(unverifiedPhone.nextCalled).toBe(false);
    expect(unverifiedPhone.statusCode).toBe(403);
    expect(unverifiedPhone.body.error.code).toBe("PHONE_NOT_VERIFIED");

    const unverifiedId = await runGuard(
      { _id: new mongoose.Types.ObjectId(), phoneVerified: true, identityStatus: "REJECTED" },
      { requireWallet: false }
    );
    expect(unverifiedId.nextCalled).toBe(false);
    expect(unverifiedId.statusCode).toBe(403);
    expect(unverifiedId.body.error.code).toBe("IDENTITY_NOT_VERIFIED");

    const verifiedNoWallet = await runGuard(
      {
        _id: new mongoose.Types.ObjectId(),
        phoneVerified: true,
        identityStatus: "VERIFIED",
        walletLinked: false,
      },
      { requireWallet: false }
    );
    expect(verifiedNoWallet.nextCalled).toBe(true);

    const needsWallet = await runGuard(
      {
        _id: new mongoose.Types.ObjectId(),
        phoneVerified: true,
        identityStatus: "VERIFIED",
        walletLinked: false,
      },
      { requireWallet: true }
    );
    expect(needsWallet.nextCalled).toBe(false);
    expect(needsWallet.statusCode).toBe(403);
    expect(needsWallet.body.error.code).toBe("WALLET_NOT_LINKED");

    const fullyVerified = await runGuard(
      {
        _id: new mongoose.Types.ObjectId(),
        phoneVerified: true,
        identityStatus: "VERIFIED",
        walletLinked: true,
        walletAddress: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
      },
      { requireWallet: true }
    );
    expect(fullyVerified.nextCalled).toBe(true);
  });
});

describe("Duplicate Identity Prevention, Gate & Integrity Integration Tests (MongoDB)", () => {
  const originalThreshold = config.identityDuplicateFlagThreshold;

  beforeAll(async () => {
    await connectTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();
    duplicateIdentityService.resetRepeatedAlertCache();
    resetUnverifiedLogCache();
    config.identityDuplicateFlagThreshold = originalThreshold;
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    config.identityDuplicateFlagThreshold = originalThreshold;
    await clearTestDb();
    await disconnectTestDb();
  });

  test("Core duplicate prevention across formatting variants, Cyrillic look-alike rejection, and valid fallback ID", async () => {
    const { user: userA, token: tokenA } =
      await createCustomerWithVerifiedPhone({ fullName: "Kavya Menon" });
    const { user: userB, token: tokenB } =
      await createCustomerWithVerifiedPhone({ fullName: "Dev Patel" });

    // User A verifies DEMO-ABC12345
    const resA = await request(app)
      .post("/api/v1/verification/identity/submit")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({
        documentType: "DEMO_ID",
        documentNumber: "DEMO-ABC12345",
        fullNameOnDocument: userA.fullName,
        consent: true,
      });
    expect(resA.status).toBe(200);

    // Same identity with formatting variants all return 409 for User B
    const variants = [
      "DEMO-ABC12345",
      "demo-abc12345",
      "  DEMO-ABC12345  ",
      "DEMO-\u200BABC12345",
      "ＤＥＭＯ-ＡＢＣ１２３４５",
    ];

    // Raise daily limit temporarily so all 5 variants can be checked on User B in one test
    const origDailyMax = config.identityMaxAttemptsPerDay;
    config.identityMaxAttemptsPerDay = 10;
    try {
      for (const variant of variants) {
        const resB = await request(app)
          .post("/api/v1/verification/identity/submit")
          .set("Authorization", `Bearer ${tokenB}`)
          .send({
            documentType: "DEMO_ID",
            documentNumber: variant,
            fullNameOnDocument: userB.fullName,
            consent: true,
          });
        expect(resB.status).toBe(409);
        expect(resB.body.error.code).toBe("IDENTITY_ALREADY_REGISTERED");
      }

      // Cyrillic "А" look-alike is rejected with 400 VALIDATION_ERROR (never treated as a new identity)
      const cyrillicRes = await request(app)
        .post("/api/v1/verification/identity/submit")
        .set("Authorization", `Bearer ${tokenB}`)
        .send({
          documentType: "DEMO_ID",
          documentNumber: "DEMO-\u0410BC12345",
          fullNameOnDocument: userB.fullName,
          consent: true,
        });
      expect(cyrillicRes.status).toBe(400);
      expect(cyrillicRes.body.error.code).toBe("VALIDATION_ERROR");

      // Confirm B stays unverified with no identityHash and A is unchanged
      const dbUserB = await User.findById(userB._id).select("+identityHash");
      expect(dbUserB.identityStatus).toBe("REJECTED");
      expect(dbUserB.identityVerified).toBe(false);
      expect(dbUserB.identityHash).toBeUndefined();

      const dbUserA = await User.findById(userA._id).select("+identityHash");
      expect(dbUserA.identityStatus).toBe("VERIFIED");
      expect(dbUserA.identityHash).toMatch(/^[a-f0-9]{64}$/);

      // A user in REJECTED status from a duplicate can still verify later with a different valid demo ID
      const validB = await request(app)
        .post("/api/v1/verification/identity/submit")
        .set("Authorization", `Bearer ${tokenB}`)
        .send({
          documentType: "DEMO_ID",
          documentNumber: "DEMO-OTHER9999",
          fullNameOnDocument: userB.fullName,
          consent: true,
        });
      expect(validB.status).toBe(200);
      expect(validB.body.data.identityStatus).toBe("VERIFIED");
    } finally {
      config.identityMaxAttemptsPerDay = origDailyMax;
    }

    // PRIVACY SEARCH TEST across every collection
    const collections = await mongoose.connection.db.collections();
    for (const col of collections) {
      const docs = await col.find({}).toArray();
      const serialized = JSON.stringify(docs);
      expect(serialized).not.toContain("ABC12345");
      expect(serialized).not.toContain("OTHER9999");
    }
  });

  test("Single path: PRE_CHECK and UNIQUE_INDEX return identical status, code, and message with zero leakage", async () => {
    const { user: userA, token: tokenA } =
      await createCustomerWithVerifiedPhone({ fullName: "Owner Fan" });
    const { user: userB, token: tokenB } =
      await createCustomerWithVerifiedPhone({ fullName: "Precheck Fan" });
    const { user: userC, token: tokenC } =
      await createCustomerWithVerifiedPhone({ fullName: "UniqueIndex Fan" });

    const okRes = await request(app)
      .post("/api/v1/verification/identity/submit")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({
        documentType: "DEMO_ID",
        documentNumber: "DEMO-SAME0001",
        fullNameOnDocument: userA.fullName,
        consent: true,
      });
    expect(okRes.status).toBe(200);

    // Path 1: PRE_CHECK
    const preCheckRes = await request(app)
      .post("/api/v1/verification/identity/submit")
      .set("Authorization", `Bearer ${tokenB}`)
      .send({
        documentType: "DEMO_ID",
        documentNumber: "DEMO-SAME0001",
        fullNameOnDocument: userB.fullName,
        consent: true,
      });

    // Path 2: Force UNIQUE_INDEX by stubbing findIdentityOwner to return null once
    const realFindOwner = duplicateIdentityService.findIdentityOwner;
    const findSpy = jest
      .spyOn(duplicateIdentityService, "findIdentityOwner")
      .mockImplementationOnce(async () => null)
      .mockImplementation(realFindOwner);

    const uniqueIndexRes = await request(app)
      .post("/api/v1/verification/identity/submit")
      .set("Authorization", `Bearer ${tokenC}`)
      .send({
        documentType: "DEMO_ID",
        documentNumber: "DEMO-SAME0001",
        fullNameOnDocument: userC.fullName,
        consent: true,
      });

    findSpy.mockRestore();

    expect(preCheckRes.status).toBe(409);
    expect(uniqueIndexRes.status).toBe(409);
    expect(preCheckRes.body).toEqual(uniqueIndexRes.body);
    expect(preCheckRes.body.error.code).toBe("IDENTITY_ALREADY_REGISTERED");

    for (const resBody of [preCheckRes.body, uniqueIndexRes.body]) {
      const serialized = JSON.stringify(resBody);
      expect(serialized).not.toContain("conflictingUserId");
      expect(serialized).not.toContain("PRE_CHECK");
      expect(serialized).not.toContain("UNIQUE_INDEX");
      expect(serialized).not.toContain(String(userA._id));
      expect(serialized).not.toContain(userA.email);
      expect(serialized).not.toContain(userA.phone);
      expect(serialized).not.toContain(userA.fullName);
    }

    // Verify SecurityLogs captured both sources accurately with conflictingUserId
    const preLog = await SecurityLog.findOne({
      userId: userB._id,
      eventType: constants.SECURITY_EVENT_TYPES.DUPLICATE_IDENTITY_ATTEMPT,
    }).lean();
    const idxLog = await SecurityLog.findOne({
      userId: userC._id,
      eventType: constants.SECURITY_EVENT_TYPES.DUPLICATE_IDENTITY_ATTEMPT,
    }).lean();
    expect(preLog.details.source).toBe("PRE_CHECK");
    expect(preLog.details.conflictingUserId).toBe(String(userA._id));
    expect(idxLog.details.source).toBe("UNIQUE_INDEX");
    expect(idxLog.details.conflictingUserId).toBe(String(userA._id));
  });

  test("Race conditions: 5 concurrent users claiming same ID yield 1x200 + 4x409; same-user double submit yields 1x200 + 1x409 ALREADY_VERIFIED", async () => {
    const fiveUsers = [];
    for (let i = 0; i < 5; i += 1) {
      fiveUsers.push(
<<<<<<< HEAD
        await createCustomerWithVerifiedPhone({ fullName: `Racer ${["One", "Two", "Three", "Four", "Five"][i]}` })
=======
        await createCustomerWithVerifiedPhone({ fullName: `Racer ${i + 1}` })
>>>>>>> origin/main
      );
    }

    const raceResponses = await Promise.all(
      fiveUsers.map(({ user, token }) =>
        request(app)
          .post("/api/v1/verification/identity/submit")
          .set("Authorization", `Bearer ${token}`)
          .send({
            documentType: "DEMO_ID",
            documentNumber: "DEMO-RACE9999",
            fullNameOnDocument: user.fullName,
            consent: true,
          })
      )
    );

    const statusCounts = raceResponses.map((r) => r.status).sort((a, b) => a - b);
    expect(statusCounts).toEqual([200, 409, 409, 409, 409]);

    const conflicts = raceResponses.filter((r) => r.status === 409);
    for (const conflict of conflicts) {
      expect(conflict.body.error.code).toBe("IDENTITY_ALREADY_REGISTERED");
    }

    const verifiedUsers = await User.find({
      identityStatus: constants.IDENTITY_STATUSES.VERIFIED,
    }).select("+identityHash");
    expect(verifiedUsers.length).toBe(1);
    expect(verifiedUsers[0].identityHash).toMatch(/^[a-f0-9]{64}$/);

    // Same user submits twice concurrently
    const { user: soloUser, token: soloToken } =
      await createCustomerWithVerifiedPhone({ fullName: "Solo Racer" });
    const [soloA, soloB] = await Promise.all([
      request(app)
        .post("/api/v1/verification/identity/submit")
        .set("Authorization", `Bearer ${soloToken}`)
        .send({
          documentType: "DEMO_ID",
          documentNumber: "DEMO-SOLO8888",
          fullNameOnDocument: soloUser.fullName,
          consent: true,
        }),
      request(app)
        .post("/api/v1/verification/identity/submit")
        .set("Authorization", `Bearer ${soloToken}`)
        .send({
          documentType: "DEMO_ID",
          documentNumber: "DEMO-SOLO8888",
          fullNameOnDocument: soloUser.fullName,
          consent: true,
        }),
    ]);

    expect([soloA.status, soloB.status].sort((a, b) => a - b)).toEqual([
      200, 409,
    ]);
    const soloConflict = soloA.status === 409 ? soloA : soloB;
    expect(soloConflict.body.error.code).toBe("IDENTITY_ALREADY_VERIFIED");
  });

  test("Counting, alerts, escalation threshold, VerificationRecord DUPLICATE_IDENTITY state, and clean SecurityLogs", async () => {
    const { user: owner, token: ownerToken } =
      await createCustomerWithVerifiedPhone({ fullName: "Original Owner" });
    const { user: attacker, token: attackerToken } =
      await createCustomerWithVerifiedPhone({ fullName: "Duplicate Attacker" });

    await request(app)
      .post("/api/v1/verification/identity/submit")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        documentType: "DEMO_ID",
        documentNumber: "DEMO-ALERT123",
        fullNameOnDocument: owner.fullName,
        consent: true,
      });

    // Set threshold to 2 so attempt 1 is below threshold and attempt 2 triggers CRITICAL escalation
    config.identityDuplicateFlagThreshold = 2;

    const dup1 = await request(app)
      .post("/api/v1/verification/identity/submit")
      .set("Authorization", `Bearer ${attackerToken}`)
      .send({
        documentType: "DEMO_ID",
        documentNumber: "DEMO-ALERT123",
        fullNameOnDocument: attacker.fullName,
        consent: true,
      });
    expect(dup1.status).toBe(409);

    const repeatedBefore = await SecurityLog.find({
      userId: attacker._id,
      eventType: constants.SECURITY_EVENT_TYPES.DUPLICATE_IDENTITY_REPEATED,
    });
    expect(repeatedBefore.length).toBe(0);

    const dup2 = await request(app)
      .post("/api/v1/verification/identity/submit")
      .set("Authorization", `Bearer ${attackerToken}`)
      .send({
        documentType: "DEMO_ID",
        documentNumber: "DEMO-ALERT123",
        fullNameOnDocument: attacker.fullName,
        consent: true,
      });
    expect(dup2.status).toBe(409);

    const repeatedAtThreshold = await SecurityLog.find({
      userId: attacker._id,
      eventType: constants.SECURITY_EVENT_TYPES.DUPLICATE_IDENTITY_REPEATED,
    }).lean();
    expect(repeatedAtThreshold.length).toBe(1);
    expect(repeatedAtThreshold[0].severity).toBe(
      constants.SECURITY_SEVERITIES.CRITICAL
    );

    // Verify VerificationRecord and User state for attacker
    const attackerRecord = await VerificationRecord.findOne({
      userId: attacker._id,
      verificationType: constants.VERIFICATION_TYPES.MOCK_KYC,
    }).select("+identityHash");
    expect(attackerRecord.status).toBe("REJECTED");
    expect(attackerRecord.reasonCode).toBe("DUPLICATE_IDENTITY");
    expect(attackerRecord.identityHash).toBeUndefined();

    const attackerDb = await User.findById(attacker._id).select("+identityHash");
    expect(attackerDb.identityStatus).toBe("REJECTED");
    expect(attackerDb.identityHash).toBeUndefined();

    // Continue hitting duplicates until IDENTITY_MAX_ATTEMPTS_PER_DAY is exhausted
    for (let i = 2; i < config.identityMaxAttemptsPerDay; i += 1) {
      const r = await request(app)
        .post("/api/v1/verification/identity/submit")
        .set("Authorization", `Bearer ${attackerToken}`)
        .send({
          documentType: "DEMO_ID",
          documentNumber: "DEMO-ALERT123",
          fullNameOnDocument: attacker.fullName,
          consent: true,
        });
      expect(r.status).toBe(409);
    }

    // Next attempt is blocked by daily attempt limit
    const limitRes = await request(app)
      .post("/api/v1/verification/identity/submit")
      .set("Authorization", `Bearer ${attackerToken}`)
      .send({
        documentType: "DEMO_ID",
        documentNumber: "DEMO-FRESH777",
        fullNameOnDocument: attacker.fullName,
        consent: true,
      });
    expect(limitRes.status).toBe(429);
    expect(limitRes.body.error.code).toBe("IDENTITY_ATTEMPT_LIMIT");

    // Only ONE DUPLICATE_IDENTITY_REPEATED entry in 24h despite multiple attempts past threshold
    const repeatedTotal = await SecurityLog.countDocuments({
      userId: attacker._id,
      eventType: constants.SECURITY_EVENT_TYPES.DUPLICATE_IDENTITY_REPEATED,
    });
    expect(repeatedTotal).toBe(1);

    // Check SecurityLogs contain conflictingUserId and zero sensitive data
    const ownerDb = await User.findById(owner._id).select("+identityHash");
    const dupLogs = await SecurityLog.find({
      userId: attacker._id,
      eventType: constants.SECURITY_EVENT_TYPES.DUPLICATE_IDENTITY_ATTEMPT,
    }).lean();
    expect(dupLogs.length).toBe(config.identityMaxAttemptsPerDay);
    expect(dupLogs[0].details.conflictingUserId).toBe(String(owner._id));

    const serializedLogs = JSON.stringify(dupLogs);
    expect(serializedLogs).not.toContain("ALERT123");
    expect(serializedLogs).not.toContain(ownerDb.identityHash);
    expect(serializedLogs).not.toContain(attacker.fullName);
    expect(serializedLogs).not.toContain("MOCK-");
  });

  test("Index sanity: User and VerificationRecord enforce unique partial identityHash index while allowing many unverified users", async () => {
    const userIndexes = await User.collection.indexes();
    const userHashIdx = userIndexes.find(
      (idx) =>
        idx.key &&
        idx.key.identityHash === 1 &&
        idx.unique === true &&
        idx.partialFilterExpression
    );
    expect(userHashIdx).toBeTruthy();

    const recordIndexes = await VerificationRecord.collection.indexes();
    const recordHashIdx = recordIndexes.find(
      (idx) =>
        idx.key &&
        idx.key.identityHash === 1 &&
        idx.unique === true &&
        idx.partialFilterExpression
    );
    expect(recordHashIdx).toBeTruthy();

    // Many users without identityHash coexist cleanly
    await Promise.all([
      createCustomerWithVerifiedPhone(),
      createCustomerWithVerifiedPhone(),
      createCustomerWithVerifiedPhone(),
    ]);
    const count = await User.countDocuments({});
    expect(count).toBe(3);
  });

  test("requireVerifiedUser gate enforces live DB state, wallet option, role precedence, and 10-minute log deduplication", async () => {
    const baseGateApp = buildVerifiedGateTestApp({ requireWallet: false });
    const walletGateApp = buildVerifiedGateTestApp({ requireWallet: true });

    // 1. Phone not verified -> 403 PHONE_NOT_VERIFIED
    const { user: noPhoneUser, token: noPhoneToken } =
      await createCustomerWithVerifiedPhone({ phoneVerified: false });
    const res1 = await request(baseGateApp)
      .get("/api/v1/test-protected/queue")
      .set("Authorization", `Bearer ${noPhoneToken}`);
    expect(res1.status).toBe(403);
    expect(res1.body.error.code).toBe("PHONE_NOT_VERIFIED");

    // 2. 10 rapid failing requests to same route write ONLY ONE UNVERIFIED_ACCESS_ATTEMPT entry within 10 minutes
    await Promise.all(
      Array.from({ length: 10 }, () =>
        request(baseGateApp)
          .get("/api/v1/test-protected/queue")
          .set("Authorization", `Bearer ${noPhoneToken}`)
      )
    );
    const unverifiedLogs = await SecurityLog.find({
      userId: noPhoneUser._id,
      eventType: constants.SECURITY_EVENT_TYPES.UNVERIFIED_ACCESS_ATTEMPT,
    }).lean();
    expect(unverifiedLogs.length).toBe(1);

    // 3. Phone verified, identity not verified -> 403 IDENTITY_NOT_VERIFIED
    const { user: phoneOnlyUser, token: phoneOnlyToken } =
      await createCustomerWithVerifiedPhone({ phoneVerified: true });
    const res2 = await request(baseGateApp)
      .get("/api/v1/test-protected/queue")
      .set("Authorization", `Bearer ${phoneOnlyToken}`);
    expect(res2.status).toBe(403);
    expect(res2.body.error.code).toBe("IDENTITY_NOT_VERIFIED");

    // 4. Live DB update after token issuance is enforced immediately on next request
    await User.updateOne(
      { _id: phoneOnlyUser._id },
      {
        $set: {
          identityStatus: constants.IDENTITY_STATUSES.VERIFIED,
          identityVerified: true,
          identityHash: "a".repeat(64),
        },
      }
    );
    const res3 = await request(baseGateApp)
      .get("/api/v1/test-protected/queue")
      .set("Authorization", `Bearer ${phoneOnlyToken}`);
    expect(res3.status).toBe(200);

    // 5. requireWallet: true -> 403 WALLET_NOT_LINKED until wallet is set in DB
    const resWalletFail = await request(walletGateApp)
      .get("/api/v1/test-protected/queue")
      .set("Authorization", `Bearer ${phoneOnlyToken}`);
    expect(resWalletFail.status).toBe(403);
    expect(resWalletFail.body.error.code).toBe("WALLET_NOT_LINKED");

    await User.updateOne(
      { _id: phoneOnlyUser._id },
      {
        $set: {
          walletLinked: true,
          walletAddress: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
        },
      }
    );
    const resWalletOk = await request(walletGateApp)
      .get("/api/v1/test-protected/queue")
      .set("Authorization", `Bearer ${phoneOnlyToken}`);
    expect(resWalletOk.status).toBe(200);

    // 6. ADMIN token gets 403 FORBIDDEN from requireRole before gate runs
    const { token: adminToken } = await createCustomerWithVerifiedPhone({
      role: constants.USER_ROLES.ADMIN,
      phoneVerified: false,
    });
    const adminRes = await request(baseGateApp)
      .get("/api/v1/test-protected/queue")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(adminRes.status).toBe(403);
    expect(adminRes.body.error.code).toBe("FORBIDDEN");
  });

  test("checkIdentityIntegrity detects every inconsistency accurately and never exposes hashes", async () => {
    // Clean DB -> zero issues
    const { user: cleanUser, token: cleanToken } =
      await createCustomerWithVerifiedPhone({ fullName: "Clean Fan" });
    await request(app)
      .post("/api/v1/verification/identity/submit")
      .set("Authorization", `Bearer ${cleanToken}`)
      .send({
        documentType: "DEMO_ID",
        documentNumber: "DEMO-CLEAN123",
        fullNameOnDocument: cleanUser.fullName,
        consent: true,
      });

    const cleanReport = await checkIdentityIntegrity();
    expect(cleanReport.ok).toBe(true);
    expect(cleanReport.totalIssues).toBe(0);

    // 1. Verified user without hash
    const { user: noHashUser } = await createCustomerWithVerifiedPhone();
    await User.collection.updateOne(
      { _id: noHashUser._id },
      { $set: { identityStatus: "VERIFIED", identityVerified: true } }
    );

    // 2. Hash without verified status
    const leakedHashMarker = "f".repeat(64);
    const { user: hashUnverifiedUser } = await createCustomerWithVerifiedPhone();
    await User.collection.updateOne(
      { _id: hashUnverifiedUser._id },
      {
        $set: {
          identityStatus: "REJECTED",
          identityVerified: false,
          identityHash: leakedHashMarker,
        },
      }
    );

    // 3. Verified record without matching VERIFIED user
    const orphanUserId = new mongoose.Types.ObjectId();
    await VerificationRecord.collection.insertOne({
      userId: orphanUserId,
      verificationType: constants.VERIFICATION_TYPES.MOCK_KYC,
      status: constants.VERIFICATION_STATUSES.VERIFIED,
      identityStatus: constants.IDENTITY_STATUSES.VERIFIED,
      providerName: "MOCK_KYC",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // 4. Verified identity with unverified phone
    const unverifiedPhoneHash = "e".repeat(64);
    const { user: unverifiedPhoneUser } = await createCustomerWithVerifiedPhone({
      phoneVerified: false,
    });
    await User.collection.updateOne(
      { _id: unverifiedPhoneUser._id },
      {
        $set: {
          identityStatus: "VERIFIED",
          identityVerified: true,
          identityHash: unverifiedPhoneHash,
        },
      }
    );

    // 5. Wallet linked without verified identity
    const leakedWalletAddress = "0x1234567890abcdef1234567890abcdef1234abcd";
    const { user: walletWithoutIdentityUser } =
      await createCustomerWithVerifiedPhone();
    await User.collection.updateOne(
      { _id: walletWithoutIdentityUser._id },
      {
        $set: {
          identityStatus: "NOT_STARTED",
          identityVerified: false,
          walletLinked: true,
          walletAddress: leakedWalletAddress,
        },
      }
    );

    const brokenReport = await checkIdentityIntegrity();
    expect(brokenReport.ok).toBe(false);
    expect(brokenReport.issues.verifiedWithoutHash).toContain(
      String(noHashUser._id)
    );
    expect(brokenReport.issues.hashWithoutVerifiedStatus).toContain(
      String(hashUnverifiedUser._id)
    );
    expect(
      brokenReport.issues.orphanedVerifiedRecords.some(
        (item) => item.userId === String(orphanUserId)
      )
    ).toBe(true);
    expect(brokenReport.issues.verifiedIdentityWithUnverifiedPhone).toContain(
      String(unverifiedPhoneUser._id)
    );
    expect(brokenReport.issues.verifiedUsersWithoutRecord).toContain(
      String(noHashUser._id)
    );
    expect(brokenReport.issues.walletWithoutVerifiedIdentity).toContain(
      String(walletWithoutIdentityUser._id)
    );

    // Output must NEVER contain any hashes or full wallet addresses
    const serializedReport = JSON.stringify(brokenReport);
    expect(serializedReport).not.toContain(leakedHashMarker);
    expect(serializedReport).not.toContain(unverifiedPhoneHash);
    expect(serializedReport.toLowerCase()).not.toContain(leakedWalletAddress);
  });
});
