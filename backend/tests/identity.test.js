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
const { toPublicUser } = require("../src/utils/publicUser");
const {
  normalizeName,
  normalizeDocumentNumber,
} = require("../src/utils/normalize");
const {
  looksLikeRealId,
  validateDemoDocumentNumber,
  validateDocumentType,
  validateConsent,
} = require("../src/utils/validators");
const { computeIdentityHash } = require("../src/utils/identityHash");
const mockIdentityProvider = require("../src/services/identity/mockIdentityProvider");
const identityProviderRegistry = require("../src/services/identity");
const { createVerificationRouter } = require("../src/routes/verification.routes");
const {
  createIdentitySubmitLimiter,
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

let userCounter = 0;

async function createTestUser(overrides = {}) {
  userCounter += 1;
  const user = await User.create({
    fullName: "Aarav Sharma",
    email: `fan${userCounter}@example.com`,
    phone: `+919876500${String(userCounter).padStart(3, "0")}`,
    passwordHash: "$2a$10$abcdefghijklmnopqrstuv1234567890abcdef",
    role: constants.USER_ROLES.CUSTOMER,
    phoneVerified: true,
    ...overrides,
  });
  const token = signAccessToken(user);
  return { user, token };
}

describe("Identity Verification Unit Tests", () => {
  test("computeIdentityHash is deterministic, 64 hex chars, case/space-insensitive, and secret-dependent", () => {
    const hash1 = computeIdentityHash({
      documentType: "DEMO_ID",
      documentNumber: "DEMO-ABC12345",
    });
    const hash2 = computeIdentityHash({
      documentType: "DEMO_ID",
      documentNumber: "  demo-abc 12345  ",
    });
    const hashDifferent = computeIdentityHash({
      documentType: "DEMO_ID",
      documentNumber: "DEMO-XYZ98765",
    });

    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hashDifferent);

    const originalSecret = process.env.IDENTITY_HASH_SECRET;
    try {
      process.env.IDENTITY_HASH_SECRET =
        "a_completely_different_test_secret_for_identity_hashing_77777777";
      jest.resetModules();
      const {
        computeIdentityHash: computeWithDifferentSecret,
      } = require("../src/utils/identityHash");
      const hashOtherSecret = computeWithDifferentSecret({
        documentType: "DEMO_ID",
        documentNumber: "DEMO-ABC12345",
      });
      expect(hashOtherSecret).toMatch(/^[a-f0-9]{64}$/);
      expect(hashOtherSecret).not.toBe(hash1);
    } finally {
      process.env.IDENTITY_HASH_SECRET = originalSecret;
      jest.resetModules();
    }
  });

  test("looksLikeRealId detects Aadhaar-like, PAN-like, and 9+ digit inputs while allowing DEMO IDs", () => {
    expect(looksLikeRealId("123456789012")).toBe(true);
    expect(looksLikeRealId("1234 5678 9012")).toBe(true);
    expect(looksLikeRealId("1234-5678-9012")).toBe(true);
    expect(looksLikeRealId("ABCDE1234F")).toBe(true);
    expect(looksLikeRealId("abcde1234f")).toBe(true);
    expect(looksLikeRealId("9876543210")).toBe(true);
    expect(looksLikeRealId("123456789")).toBe(true);

    expect(looksLikeRealId("DEMO-ABC12345")).toBe(false);
    expect(looksLikeRealId("DEMO-REJECT0001")).toBe(false);
    expect(looksLikeRealId({ value: "123456789012" })).toBe(false);
  });

  test("normalizeName and normalizeDocumentNumber handle diacritics, case, and whitespace", () => {
    expect(normalizeName("  José   María  García ")).toBe("jose maria garcia");
    expect(normalizeName("AARAV\t  SHARMA")).toBe("aarav sharma");
    expect(normalizeDocumentNumber("  demo-abc 12345 ")).toBe("DEMO-ABC12345");
  });

  test("validators enforce documentType, demo format, and boolean consent", () => {
    expect(validateDocumentType("DEMO_ID").valid).toBe(true);
    expect(validateDocumentType("AADHAAR").valid).toBe(false);
    expect(validateDemoDocumentNumber("demo-ab1234")).toEqual({
      valid: true,
      value: "DEMO-AB1234",
    });
    expect(validateDemoDocumentNumber("ABC123").valid).toBe(false);
    expect(validateConsent(true).valid).toBe(true);
    expect(validateConsent("true").valid).toBe(false);
    expect(validateConsent(false).valid).toBe(false);
  });

  test("mockIdentityProvider enforces rule order and returns random receipt reference", async () => {
    const mismatch = await mockIdentityProvider.verify({
      documentType: "DEMO_ID",
      documentNumber: "DEMO-REJECT0001",
      fullNameOnDocument: "Wrong Person",
      accountName: "Aarav Sharma",
    });
    expect(mismatch.status).toBe("REJECTED");
    expect(mismatch.reasonCode).toBe("NAME_MISMATCH");
    expect(mismatch.providerName).toBe("MOCK_KYC");
    expect(mismatch.providerReference).toMatch(/^MOCK-[a-f0-9]{16}$/);

    const docRejected = await mockIdentityProvider.verify({
      documentType: "DEMO_ID",
      documentNumber: "DEMO-REJECT0001",
      fullNameOnDocument: "Aarav Sharma",
      accountName: "Aarav Sharma",
    });
    expect(docRejected.status).toBe("REJECTED");
    expect(docRejected.reasonCode).toBe("DOCUMENT_REJECTED");

    const ok1 = await mockIdentityProvider.verify({
      documentType: "DEMO_ID",
      documentNumber: "DEMO-ABC12345",
      fullNameOnDocument: "  aarav   SHARMA ",
      accountName: "Aarav Sharma",
    });
    const ok2 = await mockIdentityProvider.verify({
      documentType: "DEMO_ID",
      documentNumber: "DEMO-ABC12345",
      fullNameOnDocument: "Aarav Sharma",
      accountName: "Aarav Sharma",
    });
    expect(ok1.status).toBe("VERIFIED");
    expect(ok1.reasonCode).toBeNull();
    expect(ok1.providerReference).toMatch(/^MOCK-[a-f0-9]{16}$/);
    expect(ok1.providerReference).not.toBe(ok2.providerReference);
    expect(JSON.stringify(ok1)).not.toContain("ABC12345");
  });

  test("toPublicUser exposes safe identityStatus and never exposes identityHash or passwordHash", () => {
    const pub = toPublicUser({
      _id: new mongoose.Types.ObjectId(),
      fullName: "Aarav Sharma",
      email: "aarav@example.com",
      phone: "+919876543210",
      passwordHash: "secret-bcrypt-hash",
      identityHash: "a".repeat(64),
      identityStatus: "VERIFIED",
      identityVerified: true,
      role: "CUSTOMER",
      accountStatus: "ACTIVE",
      phoneVerified: true,
      walletLinked: false,
    });

    expect(pub.identityStatus).toBe("VERIFIED");
    expect(pub.identityHash).toBeUndefined();
    expect(pub.passwordHash).toBeUndefined();
  });

  test("env config throws when IDENTITY_HASH_SECRET is missing, too short, or equal to JWT_SECRET", () => {
    const origJwt = process.env.JWT_SECRET;
    const origIdentitySecret = process.env.IDENTITY_HASH_SECRET;

    const loadEnv = () => {
      jest.resetModules();
      return require("../src/config/env");
    };

    try {
      delete process.env.IDENTITY_HASH_SECRET;
      expect(() => loadEnv()).toThrow(/IDENTITY_HASH_SECRET/i);

      process.env.IDENTITY_HASH_SECRET = "too_short_secret";
      expect(() => loadEnv()).toThrow(/IDENTITY_HASH_SECRET/i);

      process.env.IDENTITY_HASH_SECRET = origJwt;
      expect(() => loadEnv()).toThrow(/different from JWT_SECRET/i);
    } finally {
      process.env.JWT_SECRET = origJwt;
      process.env.IDENTITY_HASH_SECRET = origIdentitySecret;
      jest.resetModules();
    }
  });

  test("HTTP security without DB: unauthenticated request gets 401 and malformed JSON does not echo marker", async () => {
    const unauthRes = await request(app)
      .post("/api/v1/verification/identity/submit")
      .send({
        documentType: "DEMO_ID",
        documentNumber: "DEMO-ABC12345",
        fullNameOnDocument: "Aarav Sharma",
        consent: true,
      });
    expect(unauthRes.status).toBe(401);
    expect(unauthRes.body.error.code).toBe("UNAUTHORIZED");

    const secretMarker = "SENSITIVE_MARKER_99112233";
    const malformedRes = await request(app)
      .post("/api/v1/verification/identity/submit")
      .set("Content-Type", "application/json")
      .send(`{"documentNumber": "${secretMarker}", broken_json`);

    expect(malformedRes.status).toBe(400);
    expect(malformedRes.body.error.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(malformedRes.body)).not.toContain(secretMarker);
  });
});

describe("Identity Verification API & Privacy Integration Tests (MongoDB)", () => {
  beforeAll(async () => {
    await connectTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await clearTestDb();
    await disconnectTestDb();
  });

  test("Access control: ADMIN token gets 403 and unverified phone gets 403 PHONE_NOT_VERIFIED", async () => {
    const { token: adminToken } = await createTestUser({
      role: constants.USER_ROLES.ADMIN,
      phoneVerified: true,
    });

    const adminRes = await request(app)
      .post("/api/v1/verification/identity/submit")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        documentType: "DEMO_ID",
        documentNumber: "DEMO-ABC12345",
        fullNameOnDocument: "Aarav Sharma",
        consent: true,
      });
    expect(adminRes.status).toBe(403);
    expect(adminRes.body.error.code).toBe("FORBIDDEN");

    const { token: unverifiedPhoneToken } = await createTestUser({
      phoneVerified: false,
    });

    const phoneRes = await request(app)
      .post("/api/v1/verification/identity/submit")
      .set("Authorization", `Bearer ${unverifiedPhoneToken}`)
      .send({
        documentType: "DEMO_ID",
        documentNumber: "DEMO-ABC12345",
        fullNameOnDocument: "Aarav Sharma",
        consent: true,
      });
    expect(phoneRes.status).toBe(403);
    expect(phoneRes.body.error.code).toBe("PHONE_NOT_VERIFIED");
  });

  test("Success path + full-DB privacy search test + diacritic/case/space-insensitive name match", async () => {
    const consoleChunks = [];
    const logSpy = jest
      .spyOn(console, "log")
      .mockImplementation((...args) => consoleChunks.push(args.join(" ")));
    const errSpy = jest
      .spyOn(console, "error")
      .mockImplementation((...args) => consoleChunks.push(args.join(" ")));
    const warnSpy = jest
      .spyOn(console, "warn")
      .mockImplementation((...args) => consoleChunks.push(args.join(" ")));

    const { user, token } = await createTestUser({
      fullName: "José García",
    });

    const res = await request(app)
      .post("/api/v1/verification/identity/submit")
      .set("Authorization", `Bearer ${token}`)
      .set("User-Agent", "FairTicket-Test-Agent/1.0")
      .send({
        documentType: "DEMO_ID",
        documentNumber: "DEMO-ABC12345",
        fullNameOnDocument: "  jose   GARCIA ",
        consent: true,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.identityStatus).toBe("VERIFIED");
    expect(res.body.data.verifiedAt).toBeTruthy();
    expect(res.body.data.identityHash).toBeUndefined();

    const dbUser = await User.findById(user._id).select("+identityHash");
    expect(dbUser.identityStatus).toBe("VERIFIED");
    expect(dbUser.identityVerified).toBe(true);
    expect(dbUser.identityHash).toMatch(/^[a-f0-9]{64}$/);
    expect(toPublicUser(dbUser).identityHash).toBeUndefined();

    // PRIVACY SEARCH TEST: scan every document in every collection + console output
    const collections = await mongoose.connection.db.collections();
    for (const col of collections) {
      const docs = await col.find({}).toArray();
      const serialized = JSON.stringify(docs);
      expect(serialized).not.toContain("ABC12345");
      expect(serialized).not.toContain("DEMO-ABC12345");
    }
    const capturedConsole = consoleChunks.join("\n");
    expect(capturedConsole).not.toContain("ABC12345");
    expect(capturedConsole).not.toContain("DEMO-ABC12345");

    logSpy.mockRestore();
    errSpy.mockRestore();
    warnSpy.mockRestore();

    // Second submission after success returns 409 IDENTITY_ALREADY_VERIFIED
    const secondRes = await request(app)
      .post("/api/v1/verification/identity/submit")
      .set("Authorization", `Bearer ${token}`)
      .send({
        documentType: "DEMO_ID",
        documentNumber: "DEMO-ABC12345",
        fullNameOnDocument: "José García",
        consent: true,
      });
    expect(secondRes.status).toBe(409);
    expect(secondRes.body.error.code).toBe("IDENTITY_ALREADY_VERIFIED");
  });

  test("Rejections: NAME_MISMATCH (retryable) and DOCUMENT_REJECTED", async () => {
    const { user, token } = await createTestUser({
      fullName: "Priya Nair",
    });

    const mismatchRes = await request(app)
      .post("/api/v1/verification/identity/submit")
      .set("Authorization", `Bearer ${token}`)
      .send({
        documentType: "DEMO_ID",
        documentNumber: "DEMO-ABC12345",
        fullNameOnDocument: "Someone Else",
        consent: true,
      });

    expect(mismatchRes.status).toBe(422);
    expect(mismatchRes.body.error.code).toBe("IDENTITY_REJECTED");
    expect(mismatchRes.body.error.details.reasonCode).toBe("NAME_MISMATCH");

    const userAfterReject = await User.findById(user._id);
    expect(userAfterReject.identityStatus).toBe("REJECTED");

    const docRejectRes = await request(app)
      .post("/api/v1/verification/identity/submit")
      .set("Authorization", `Bearer ${token}`)
      .send({
        documentType: "DEMO_ID",
        documentNumber: "DEMO-REJECT0001",
        fullNameOnDocument: "Priya Nair",
        consent: true,
      });
    expect(docRejectRes.status).toBe(422);
    expect(docRejectRes.body.error.code).toBe("IDENTITY_REJECTED");
    expect(docRejectRes.body.error.details.reasonCode).toBe("DOCUMENT_REJECTED");

    // User can retry and succeed with valid name and valid demo ID
    const retryRes = await request(app)
      .post("/api/v1/verification/identity/submit")
      .set("Authorization", `Bearer ${token}`)
      .send({
        documentType: "DEMO_ID",
        documentNumber: "DEMO-PASS9999",
        fullNameOnDocument: "Priya Nair",
        consent: true,
      });
    expect(retryRes.status).toBe(200);
    expect(retryRes.body.data.identityStatus).toBe("VERIFIED");
  });

  test("Real-ID safety check blocks Aadhaar-like, PAN-like, and 10-digit values without storing or counting attempts", async () => {
    const { user, token } = await createTestUser();
    const realIdSamples = [
      "123456789012",
      "1234 5678 9012",
      "ABCDE1234F",
      "9876543210",
    ];

    for (const sample of realIdSamples) {
      const res = await request(app)
        .post("/api/v1/verification/identity/submit")
        .set("Authorization", `Bearer ${token}`)
        .send({
          documentType: "DEMO_ID",
          documentNumber: sample,
          fullNameOnDocument: user.fullName,
          consent: true,
        });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("REAL_ID_NOT_ALLOWED");
      expect(JSON.stringify(res.body)).not.toContain(sample);
    }

    const logs = await SecurityLog.find({
      userId: user._id,
      eventType: constants.SECURITY_EVENT_TYPES.REAL_ID_BLOCKED,
    }).lean();
    expect(logs.length).toBe(realIdSamples.length);
    expect(logs[0].severity).toBe(constants.SECURITY_SEVERITIES.MEDIUM);

    const serializedLogs = JSON.stringify(logs);
    for (const sample of realIdSamples) {
      expect(serializedLogs).not.toContain(sample);
    }

    // Attempt counter must remain untouched (0 attempts used)
    const statusRes = await request(app)
      .get("/api/v1/verification/status")
      .set("Authorization", `Bearer ${token}`);
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.data.identity.attemptsRemaining).toBe(
      config.identityMaxAttemptsPerDay
    );
  });

  test("Validation rejects bad formats, missing/string consent, unknown fields, non-string types, and unsupported documentType", async () => {
    const { token } = await createTestUser();

    const badFormat = await request(app)
      .post("/api/v1/verification/identity/submit")
      .set("Authorization", `Bearer ${token}`)
      .send({
        documentType: "DEMO_ID",
        documentNumber: "ABC123",
        fullNameOnDocument: "A",
        consent: "true",
      });
    expect(badFormat.status).toBe(400);
    expect(badFormat.body.error.code).toBe("VALIDATION_ERROR");
    expect(badFormat.body.error.details).toHaveProperty("documentNumber");
    expect(badFormat.body.error.details).toHaveProperty("fullNameOnDocument");
    expect(badFormat.body.error.details).toHaveProperty("consent");

    const missingFields = await request(app)
      .post("/api/v1/verification/identity/submit")
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(missingFields.status).toBe(400);
    expect(missingFields.body.error.code).toBe("VALIDATION_ERROR");
    expect(missingFields.body.error.details).toHaveProperty("documentType");
    expect(missingFields.body.error.details).toHaveProperty("documentNumber");
    expect(missingFields.body.error.details).toHaveProperty("fullNameOnDocument");
    expect(missingFields.body.error.details).toHaveProperty("consent");

    for (const unknownKey of ["identityHash", "identityStatus", "role"]) {
      const unknownRes = await request(app)
        .post("/api/v1/verification/identity/submit")
        .set("Authorization", `Bearer ${token}`)
        .send({
          documentType: "DEMO_ID",
          documentNumber: "DEMO-ABC12345",
          fullNameOnDocument: "Aarav Sharma",
          consent: true,
          [unknownKey]: "injected",
        });
      expect(unknownRes.status).toBe(400);
      expect(unknownRes.body.error.code).toBe("VALIDATION_ERROR");
    }

    const badTypes = [
      { documentNumber: { $ne: null } },
      { documentType: ["DEMO_ID"] },
      { fullNameOnDocument: 12345 },
    ];
    for (const badPayload of badTypes) {
      const typeRes = await request(app)
        .post("/api/v1/verification/identity/submit")
        .set("Authorization", `Bearer ${token}`)
        .send({
          documentType: "DEMO_ID",
          documentNumber: "DEMO-ABC12345",
          fullNameOnDocument: "Aarav Sharma",
          consent: true,
          ...badPayload,
        });
      expect(typeRes.status).toBe(400);
      expect(typeRes.body.error.code).toBe("VALIDATION_ERROR");
    }

    const unsupportedDocType = await request(app)
      .post("/api/v1/verification/identity/submit")
      .set("Authorization", `Bearer ${token}`)
      .send({
        documentType: "PASSPORT",
        documentNumber: "DEMO-ABC12345",
        fullNameOnDocument: "Aarav Sharma",
        consent: true,
      });
    expect(unsupportedDocType.status).toBe(400);
    expect(unsupportedDocType.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("Daily attempt limit blocks after max attempts and resets after 24 hours", async () => {
    const { user, token } = await createTestUser();

    for (let i = 0; i < config.identityMaxAttemptsPerDay; i += 1) {
      const rejectRes = await request(app)
        .post("/api/v1/verification/identity/submit")
        .set("Authorization", `Bearer ${token}`)
        .send({
          documentType: "DEMO_ID",
          documentNumber: "DEMO-REJECT0001",
          fullNameOnDocument: user.fullName,
          consent: true,
        });
      expect(rejectRes.status).toBe(422);
    }

    const blockedRes = await request(app)
      .post("/api/v1/verification/identity/submit")
      .set("Authorization", `Bearer ${token}`)
      .send({
        documentType: "DEMO_ID",
        documentNumber: "DEMO-ABC12345",
        fullNameOnDocument: user.fullName,
        consent: true,
      });
    expect(blockedRes.status).toBe(429);
    expect(blockedRes.body.error.code).toBe("IDENTITY_ATTEMPT_LIMIT");

    // Move attemptWindowStartedAt back more than 24 hours
    const olderThan24h = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await VerificationRecord.updateOne(
      { userId: user._id, verificationType: constants.VERIFICATION_TYPES.MOCK_KYC },
      { $set: { attemptWindowStartedAt: olderThan24h } }
    );

    const retryAfterWindow = await request(app)
      .post("/api/v1/verification/identity/submit")
      .set("Authorization", `Bearer ${token}`)
      .send({
        documentType: "DEMO_ID",
        documentNumber: "DEMO-ABC12345",
        fullNameOnDocument: user.fullName,
        consent: true,
      });
    expect(retryAfterWindow.status).toBe(200);
    expect(retryAfterWindow.body.data.identityStatus).toBe("VERIFIED");
  });

  test("Concurrency: two simultaneous valid submissions yield exactly one 200 and one 409 IDENTITY_ALREADY_VERIFIED", async () => {
    const { user, token } = await createTestUser();

    const payload = {
      documentType: "DEMO_ID",
      documentNumber: "DEMO-RACE1234",
      fullNameOnDocument: user.fullName,
      consent: true,
    };

    const [resA, resB] = await Promise.all([
      request(app)
        .post("/api/v1/verification/identity/submit")
        .set("Authorization", `Bearer ${token}`)
        .send(payload),
      request(app)
        .post("/api/v1/verification/identity/submit")
        .set("Authorization", `Bearer ${token}`)
        .send(payload),
    ]);

    const statuses = [resA.status, resB.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 409]);

    const failedRes = resA.status === 409 ? resA : resB;
    expect(failedRes.body.error.code).toBe("IDENTITY_ALREADY_VERIFIED");

    const dbUser = await User.findById(user._id).select("+identityHash");
    expect(dbUser.identityStatus).toBe("VERIFIED");
    expect(dbUser.identityHash).toMatch(/^[a-f0-9]{64}$/);
  });

  test("Provider failure returns 502 and does not consume an attempt", async () => {
    const { user, token } = await createTestUser();

    jest
      .spyOn(identityProviderRegistry, "getIdentityProvider")
      .mockReturnValue({
        verify: jest.fn().mockRejectedValue(new Error("Upstream provider down")),
      });

    const failRes = await request(app)
      .post("/api/v1/verification/identity/submit")
      .set("Authorization", `Bearer ${token}`)
      .send({
        documentType: "DEMO_ID",
        documentNumber: "DEMO-ABC12345",
        fullNameOnDocument: user.fullName,
        consent: true,
      });

    expect(failRes.status).toBe(502);
    expect(failRes.body.error.code).toBe("IDENTITY_PROVIDER_FAILED");

    const statusRes = await request(app)
      .get("/api/v1/verification/status")
      .set("Authorization", `Bearer ${token}`);
    expect(statusRes.body.data.identity.attemptsRemaining).toBe(
      config.identityMaxAttemptsPerDay
    );
  });

  test("Rate limiter returns 429 RATE_LIMITED when exceeded", async () => {
    const { user, token } = await createTestUser();

    const limitedApp = express();
    limitedApp.use(express.json());
    limitedApp.use(
      "/api/v1/verification",
      createVerificationRouter({
        identitySubmitLimiter: createIdentitySubmitLimiter({
          windowMs: 60 * 1000,
          max: 2,
        }),
      })
    );
    limitedApp.use(notFoundHandler);
    limitedApp.use(errorHandler);

    for (let i = 0; i < 2; i += 1) {
      const res = await request(limitedApp)
        .post("/api/v1/verification/identity/submit")
        .set("Authorization", `Bearer ${token}`)
        .send({
          documentType: "DEMO_ID",
          documentNumber: "DEMO-REJECT0001",
          fullNameOnDocument: user.fullName,
          consent: true,
        });
      expect(res.status).toBe(422);
    }

    const thirdRes = await request(limitedApp)
      .post("/api/v1/verification/identity/submit")
      .set("Authorization", `Bearer ${token}`)
      .send({
        documentType: "DEMO_ID",
        documentNumber: "DEMO-ABC12345",
        fullNameOnDocument: user.fullName,
        consent: true,
      });
    expect(thirdRes.status).toBe(429);
    expect(thirdRes.body.error.code).toBe("RATE_LIMITED");
  });

  test("Basic duplicate safety net blocks same demo ID across accounts regardless of case/spacing", async () => {
    const { user: user1, token: token1 } = await createTestUser({
      fullName: "Rohan Verma",
    });
    const { user: user2, token: token2 } = await createTestUser({
      fullName: "Meera Kapoor",
    });

    const firstRes = await request(app)
      .post("/api/v1/verification/identity/submit")
      .set("Authorization", `Bearer ${token1}`)
      .send({
        documentType: "DEMO_ID",
        documentNumber: "DEMO-ABC12345",
        fullNameOnDocument: user1.fullName,
        consent: true,
      });
    expect(firstRes.status).toBe(200);

    const dupRes = await request(app)
      .post("/api/v1/verification/identity/submit")
      .set("Authorization", `Bearer ${token2}`)
      .send({
        documentType: "DEMO_ID",
        documentNumber: "  demo-abc12345  ",
        fullNameOnDocument: user2.fullName,
        consent: true,
      });
    expect(dupRes.status).toBe(409);
    expect(dupRes.body.error.code).toBe("IDENTITY_ALREADY_REGISTERED");
    expect(JSON.stringify(dupRes.body)).not.toContain(user1.email);
    expect(JSON.stringify(dupRes.body)).not.toContain(user1.fullName);

    const dbUser2 = await User.findById(user2._id).select("+identityHash");
    expect(dbUser2.identityStatus).not.toBe("VERIFIED");
    expect(dbUser2.identityVerified).toBe(false);
    expect(dbUser2.identityHash).toBeUndefined();
  });

  test("GET /verification/status and SecurityLogs never expose hash, document number, name, or providerReference", async () => {
    const { user, token } = await createTestUser({
      fullName: "Ananya Iyer",
    });

    await request(app)
      .post("/api/v1/verification/identity/submit")
      .set("Authorization", `Bearer ${token}`)
      .send({
        documentType: "DEMO_ID",
        documentNumber: "DEMO-REJECT0001",
        fullNameOnDocument: user.fullName,
        consent: true,
      });

    await request(app)
      .post("/api/v1/verification/identity/submit")
      .set("Authorization", `Bearer ${token}`)
      .send({
        documentType: "DEMO_ID",
        documentNumber: "DEMO-SAFE7777",
        fullNameOnDocument: user.fullName,
        consent: true,
      });

    const statusRes = await request(app)
      .get("/api/v1/verification/status")
      .set("Authorization", `Bearer ${token}`);

    expect(statusRes.status).toBe(200);
    expect(statusRes.body.data.identity.status).toBe("VERIFIED");
    expect(typeof statusRes.body.data.identity.attemptsRemaining).toBe("number");
    expect(statusRes.body.data.identity.attemptsRemaining).toBe(
      config.identityMaxAttemptsPerDay - 2
    );

    const statusStr = JSON.stringify(statusRes.body);
    expect(statusStr).not.toContain("identityHash");
    expect(statusStr).not.toContain("providerReference");
    expect(statusStr).not.toContain("SAFE7777");

    const dbUser = await User.findById(user._id).select("+identityHash");
    const dbRecord = await VerificationRecord.findOne({
      userId: user._id,
      verificationType: constants.VERIFICATION_TYPES.MOCK_KYC,
    });

    const logs = await SecurityLog.find({ userId: user._id }).lean();
    const types = logs.map((l) => l.eventType);
    expect(types).toContain(constants.SECURITY_EVENT_TYPES.IDENTITY_SUBMITTED);
    expect(types).toContain(constants.SECURITY_EVENT_TYPES.IDENTITY_REJECTED);
    expect(types).toContain(constants.SECURITY_EVENT_TYPES.IDENTITY_VERIFIED);

    const logsSerialized = JSON.stringify(logs);
    expect(logsSerialized).not.toContain("SAFE7777");
    expect(logsSerialized).not.toContain("REJECT0001");
    expect(logsSerialized).not.toContain("Ananya Iyer");
    expect(logsSerialized).not.toContain(dbUser.identityHash);
    if (dbRecord && dbRecord.providerReference) {
      expect(logsSerialized).not.toContain(dbRecord.providerReference);
    }
  });
});
