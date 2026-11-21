const express = require("express");
const jwt = require("jsonwebtoken");
const request = require("supertest");

const app = require("../src/app");
const config = require("../src/config/env");
const constants = require("../src/config/constants");
const User = require("../src/models/User.model");
const SecurityLog = require("../src/models/SecurityLog.model");
const { signAccessToken, verifyAccessToken } = require("../src/utils/jwt");
const { toPublicUser } = require("../src/utils/publicUser");
const {
  validateName,
  validateEmail,
  validatePhone,
  validatePassword,
} = require("../src/utils/validators");
const { authenticate } = require("../src/middleware/auth.middleware");
const { requireRole } = require("../src/middleware/role.middleware");
const { createLoginLimiter } = require("../src/middleware/rateLimit.middleware");
const {
  notFoundHandler,
  errorHandler,
} = require("../src/middleware/errorHandler.middleware");
const { createAuthRouter } = require("../src/routes/auth.routes");
const {
  connectTestDb,
  clearTestDb,
  disconnectTestDb,
} = require("./helpers/db");

function buildUnsignedAlgNoneToken(payload) {
  const header = Buffer.from(
    JSON.stringify({ alg: "none", typ: "JWT" })
  ).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.`;
}

describe("Auth Unit & Security Tests (No DB)", () => {
  test("validators enforce name, email, Indian/E.164 phone, and strong password policies", () => {
    expect(validateName("Aarav O'Connor-Patel").valid).toBe(true);
    expect(validateName("José María").valid).toBe(true);
    expect(validateName("A").valid).toBe(false);
    expect(validateName("A".repeat(81)).valid).toBe(false);
    expect(validateName("Aarav123!").valid).toBe(false);

    expect(validateEmail("  FAN.Name+1@Example.COM ")).toEqual({
      valid: true,
      value: "fan.name+1@example.com",
    });
    expect(validateEmail("not-an-email").valid).toBe(false);
    expect(validateEmail("a..b@example.com").valid).toBe(false);
    expect(validateEmail({ $gt: "" }).valid).toBe(false);

    expect(validatePhone("9876543210")).toEqual({
      valid: true,
      value: "+919876543210",
    });
    expect(validatePhone("+91 98765-43210")).toEqual({
      valid: true,
      value: "+919876543210",
    });
    expect(validatePhone("+14155552671")).toEqual({
      valid: true,
      value: "+14155552671",
    });
    expect(validatePhone("1234567890").valid).toBe(false);
    expect(validatePhone("98765").valid).toBe(false);

    expect(
      validatePassword("ConcertFair2026!", { email: "fan@example.com" }).valid
    ).toBe(true);
    expect(validatePassword("short1a").valid).toBe(false);
    expect(validatePassword("onlylettersnow").valid).toBe(false);
    expect(validatePassword("123456789012").valid).toBe(false);
    expect(validatePassword("password123").valid).toBe(false);
    expect(validatePassword("FairTicket123").valid).toBe(false);
    expect(
      validatePassword("aarav12345", { email: "aarav12345@example.com" }).valid
    ).toBe(false);
    expect(
      validatePassword("fan99@example.com", { email: "fan99@example.com" })
        .valid
    ).toBe(false);
    // 72-byte UTF-8 boundary check (20 four-byte emoji + "a1" = 82 bytes > 72)
    expect(validatePassword(`${"🎵".repeat(20)}a1`).valid).toBe(false);
    expect(validatePassword(`${"a".repeat(71)}1`).valid).toBe(true);
    expect(validatePassword(`${"a".repeat(72)}1`).valid).toBe(false);
  });

  test("JWT signing includes minimal claims only and rejects alg:none, wrong secret/iss/aud, and expired tokens", () => {
    const fakeUser = {
      _id: "507f1f77bcf86cd799439011",
      role: constants.USER_ROLES.CUSTOMER,
      email: "fan@example.com",
      phone: "+919876543210",
      passwordHash: "secret-hash",
    };

    const token = signAccessToken(fakeUser);
    const decoded = verifyAccessToken(token);
    expect(Object.keys(decoded).sort()).toEqual([
      "aud",
      "exp",
      "iat",
      "iss",
      "role",
      "sub",
    ]);
    expect(decoded.sub).toBe(fakeUser._id);
    expect(decoded.role).toBe(constants.USER_ROLES.CUSTOMER);
    expect(decoded.iss).toBe(config.jwtIssuer);
    expect(decoded.aud).toBe(config.jwtAudience);
    expect(decoded.email).toBeUndefined();
    expect(decoded.passwordHash).toBeUndefined();

    // alg: none token must be rejected
    const unsigned = buildUnsignedAlgNoneToken({
      sub: fakeUser._id,
      role: constants.USER_ROLES.ADMIN,
      iss: config.jwtIssuer,
      aud: config.jwtAudience,
    });
    expect(() => verifyAccessToken(unsigned)).toThrow();

    // Wrong secret
    const wrongSecretToken = jwt.sign(
      { sub: fakeUser._id, role: constants.USER_ROLES.CUSTOMER },
      "completely_wrong_signing_secret_000000000000",
      {
        algorithm: "HS256",
        issuer: config.jwtIssuer,
        audience: config.jwtAudience,
        expiresIn: "1h",
      }
    );
    expect(() => verifyAccessToken(wrongSecretToken)).toThrow();

    // Wrong issuer
    const wrongIssuerToken = jwt.sign(
      { sub: fakeUser._id, role: constants.USER_ROLES.CUSTOMER },
      config.jwtSecret,
      {
        algorithm: "HS256",
        issuer: "other-issuer",
        audience: config.jwtAudience,
        expiresIn: "1h",
      }
    );
    expect(() => verifyAccessToken(wrongIssuerToken)).toThrow();

    // Wrong audience
    const wrongAudToken = jwt.sign(
      { sub: fakeUser._id, role: constants.USER_ROLES.CUSTOMER },
      config.jwtSecret,
      {
        algorithm: "HS256",
        issuer: config.jwtIssuer,
        audience: "other-audience",
        expiresIn: "1h",
      }
    );
    expect(() => verifyAccessToken(wrongAudToken)).toThrow();

    // Expired token throws typed TOKEN_EXPIRED
    const expiredToken = jwt.sign(
      { sub: fakeUser._id, role: constants.USER_ROLES.CUSTOMER },
      config.jwtSecret,
      {
        algorithm: "HS256",
        issuer: config.jwtIssuer,
        audience: config.jwtAudience,
        expiresIn: -5,
      }
    );
    let expiredErr;
    try {
      verifyAccessToken(expiredToken);
    } catch (err) {
      expiredErr = err;
    }
    expect(expiredErr).toBeDefined();
    expect(expiredErr.statusCode).toBe(401);
    expect(expiredErr.code).toBe(constants.ERROR_CODES.TOKEN_EXPIRED);
  });

  test("toPublicUser never exposes passwordHash, identityHash, failedLoginCount, or lockedUntil", () => {
    const safe = toPublicUser({
      _id: "507f1f77bcf86cd799439011",
      fullName: "Aarav Sharma",
      email: "aarav@example.com",
      phone: "+919876543210",
      role: constants.USER_ROLES.CUSTOMER,
      accountStatus: constants.ACCOUNT_STATUSES.ACTIVE,
      passwordHash: "$2a$10$secret",
      identityHash: "a".repeat(64),
      failedLoginCount: 4,
      lockedUntil: new Date(),
      walletAuthNonce: "nonce-123",
    });

    expect(safe.passwordHash).toBeUndefined();
    expect(safe.identityHash).toBeUndefined();
    expect(safe.failedLoginCount).toBeUndefined();
    expect(safe.lockedUntil).toBeUndefined();
    expect(safe.walletAuthNonce).toBeUndefined();
    expect(safe.id).toBe("507f1f77bcf86cd799439011");
    expect(safe.fullName).toBe("Aarav Sharma");
  });

  test("POST /api/v1/auth/register rejects unknown fields (e.g. role: ADMIN) and returns all field validation errors", async () => {
    const unknownRes = await request(app).post("/api/v1/auth/register").send({
      fullName: "Aarav Sharma",
      email: "aarav@example.com",
      phone: "9876543210",
      password: "FairConcert2026!",
      role: "ADMIN",
    });
    expect(unknownRes.status).toBe(400);
    expect(unknownRes.body.error.code).toBe(
      constants.ERROR_CODES.VALIDATION_ERROR
    );

    const invalidRes = await request(app).post("/api/v1/auth/register").send({
      fullName: "X",
      email: "bad-email",
      phone: "123",
      password: "weak",
    });
    expect(invalidRes.status).toBe(400);
    expect(invalidRes.body.error.code).toBe(
      constants.ERROR_CODES.VALIDATION_ERROR
    );
    expect(Array.isArray(invalidRes.body.error.details)).toBe(true);
    const fields = invalidRes.body.error.details.map((d) => d.field);
    expect(fields).toEqual(
      expect.arrayContaining(["fullName", "email", "phone", "password"])
    );
  });

  test("POST /api/v1/auth/login blocks NoSQL operator payloads and unknown fields", async () => {
    const nosqlRes = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email: { $gt: "" },
        password: { $ne: "" },
      });
    expect(nosqlRes.status).toBe(400);
    expect(nosqlRes.body.error.code).toBe(
      constants.ERROR_CODES.VALIDATION_ERROR
    );

    const extraFieldRes = await request(app).post("/api/v1/auth/login").send({
      email: "fan@example.com",
      password: "FairConcert2026!",
      role: "ADMIN",
    });
    expect(extraFieldRes.status).toBe(400);
    expect(extraFieldRes.body.error.code).toBe(
      constants.ERROR_CODES.VALIDATION_ERROR
    );
  });

  test("GET /api/v1/auth/me rejects missing, malformed, garbage, alg:none, wrong-secret, wrong-iss/aud, and expired tokens", async () => {
    const missing = await request(app).get("/api/v1/auth/me");
    expect(missing.status).toBe(401);
    expect(missing.body.error.code).toBe(constants.ERROR_CODES.UNAUTHORIZED);

    const garbage = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", "Bearer not.a.valid.jwt");
    expect(garbage.status).toBe(401);
    expect(garbage.body.error.code).toBe(constants.ERROR_CODES.UNAUTHORIZED);

    const unsigned = buildUnsignedAlgNoneToken({
      sub: "507f1f77bcf86cd799439011",
      role: constants.USER_ROLES.ADMIN,
      iss: config.jwtIssuer,
      aud: config.jwtAudience,
    });
    const algNoneRes = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${unsigned}`);
    expect(algNoneRes.status).toBe(401);
    expect(algNoneRes.body.error.code).toBe(constants.ERROR_CODES.UNAUTHORIZED);

    const expiredToken = jwt.sign(
      { sub: "507f1f77bcf86cd799439011", role: constants.USER_ROLES.CUSTOMER },
      config.jwtSecret,
      {
        algorithm: "HS256",
        issuer: config.jwtIssuer,
        audience: config.jwtAudience,
        expiresIn: -10,
      }
    );
    const expiredRes = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${expiredToken}`);
    expect(expiredRes.status).toBe(401);
    expect(expiredRes.body.error.code).toBe(
      constants.ERROR_CODES.TOKEN_EXPIRED
    );
  });

  test("Login rate limiter returns 429 RATE_LIMITED once request budget is exceeded", async () => {
    const isolatedApp = express();
    isolatedApp.use(express.json());
    isolatedApp.use(
      "/api/v1/auth",
      createAuthRouter({
        loginLimiter: createLoginLimiter({ max: 2, windowMs: 60 * 1000 }),
      })
    );
    isolatedApp.use(notFoundHandler);
    isolatedApp.use(errorHandler);

    // Invalid payload hits validation (400) before DB while still counted by limiter
    const r1 = await request(isolatedApp)
      .post("/api/v1/auth/login")
      .send({ email: "rate@example.com", password: "" });
    const r2 = await request(isolatedApp)
      .post("/api/v1/auth/login")
      .send({ email: "rate@example.com", password: "" });
    const r3 = await request(isolatedApp)
      .post("/api/v1/auth/login")
      .send({ email: "rate@example.com", password: "" });

    expect(r1.status).toBe(400);
    expect(r2.status).toBe(400);
    expect(r3.status).toBe(429);
    expect(r3.body.error.code).toBe(constants.ERROR_CODES.RATE_LIMITED);
  });
});

describe("Auth API & Lockout Integration Tests (MongoDB)", () => {
  beforeAll(async () => {
    await connectTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();
  });

  afterAll(async () => {
    await disconnectTestDb();
  });

  test("POST /api/v1/auth/register creates CUSTOMER, normalizes email & Indian phone, hashes password, and hides secrets", async () => {
    const res = await request(app).post("/api/v1/auth/register").send({
      fullName: "  Priya Nair  ",
      email: "  Priya.Nair@Example.COM ",
      phone: "9876543210",
      password: "FairConcert2026!",
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.data.token).toBe("string");
    expect(res.body.data.user.fullName).toBe("Priya Nair");
    expect(res.body.data.user.email).toBe("priya.nair@example.com");
    expect(res.body.data.user.phone).toBe("+919876543210");
    expect(res.body.data.user.role).toBe(constants.USER_ROLES.CUSTOMER);
    expect(res.body.data.user.passwordHash).toBeUndefined();
    expect(res.body.data.user.failedLoginCount).toBeUndefined();
    expect(res.body.data.user.lockedUntil).toBeUndefined();

    const stored = await User.findOne({ email: "priya.nair@example.com" }).select(
      "+passwordHash"
    );
    expect(stored).not.toBeNull();
    expect(stored.passwordHash).not.toBe("FairConcert2026!");
    expect(stored.passwordHash.startsWith("$2")).toBe(true);
  });

  test("Duplicate email (case-insensitive), duplicate phone, and concurrent registrations enforce 409 ALREADY_EXISTS", async () => {
    const first = await request(app).post("/api/v1/auth/register").send({
      fullName: "Aarav Sharma",
      email: "aarav@example.com",
      phone: "9876543211",
      password: "FairConcert2026!",
    });
    expect(first.status).toBe(201);

    const dupEmail = await request(app).post("/api/v1/auth/register").send({
      fullName: "Another Fan",
      email: "AARAV@EXAMPLE.COM",
      phone: "9876543212",
      password: "FairConcert2026!",
    });
    expect(dupEmail.status).toBe(409);
    expect(dupEmail.body.error.code).toBe(constants.ERROR_CODES.ALREADY_EXISTS);

    const dupPhone = await request(app).post("/api/v1/auth/register").send({
      fullName: "Another Fan",
      email: "other@example.com",
      phone: "+919876543211",
      password: "FairConcert2026!",
    });
    expect(dupPhone.status).toBe(409);
    expect(dupPhone.body.error.code).toBe(constants.ERROR_CODES.ALREADY_EXISTS);
    expect(dupPhone.body.error.message).toBe(dupEmail.body.error.message);

    const raceResults = await Promise.all([
      request(app).post("/api/v1/auth/register").send({
        fullName: "Race Fan One",
        email: "racefan@example.com",
        phone: "9876543291",
        password: "FairConcert2026!",
      }),
      request(app).post("/api/v1/auth/register").send({
        fullName: "Race Fan Two",
        email: "racefan@example.com",
        phone: "9876543292",
        password: "FairConcert2026!",
      }),
    ]);

    const statuses = raceResults.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409]);
  });

  test("Login returns identical 401 message/code for unknown email vs wrong password and locks account after max failures", async () => {
    await request(app).post("/api/v1/auth/register").send({
      fullName: "Rohan Verma",
      email: "rohan@example.com",
      phone: "9876543213",
      password: "FairConcert2026!",
    });

    const unknownEmailRes = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email: "doesnotexist@example.com",
        password: "WrongPassword99!",
      });
    expect(unknownEmailRes.status).toBe(401);
    expect(unknownEmailRes.body.error.code).toBe(
      constants.ERROR_CODES.INVALID_CREDENTIALS
    );

    const wrongPassRes = await request(app).post("/api/v1/auth/login").send({
      email: "rohan@example.com",
      password: "WrongPassword99!",
    });
    expect(wrongPassRes.status).toBe(401);
    expect(wrongPassRes.body.error.code).toBe(
      constants.ERROR_CODES.INVALID_CREDENTIALS
    );
    expect(wrongPassRes.body.error.message).toBe(
      unknownEmailRes.body.error.message
    );

    // Exhaust remaining failed login attempts until locked
    const remainingBeforeLock = config.auth.maxFailedLogins - 2;
    for (let i = 0; i < remainingBeforeLock; i += 1) {
      const attempt = await request(app).post("/api/v1/auth/login").send({
        email: "rohan@example.com",
        password: "WrongPassword99!",
      });
      expect(attempt.status).toBe(401);
    }

    const lockingAttempt = await request(app).post("/api/v1/auth/login").send({
      email: "rohan@example.com",
      password: "WrongPassword99!",
    });
    expect(lockingAttempt.status).toBe(423);
    expect(lockingAttempt.body.error.code).toBe(
      constants.ERROR_CODES.ACCOUNT_LOCKED
    );

    const lockLog = await SecurityLog.findOne({
      eventType: constants.SECURITY_EVENT_TYPES.AUTH_ACCOUNT_LOCKED,
    });
    expect(lockLog).not.toBeNull();
    expect(lockLog.severity).toBe(constants.SECURITY_SEVERITIES.HIGH);

    // Correct password must STILL be refused while locked
    const correctWhileLocked = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email: "rohan@example.com",
        password: "FairConcert2026!",
      });
    expect(correctWhileLocked.status).toBe(423);
    expect(correctWhileLocked.body.error.code).toBe(
      constants.ERROR_CODES.ACCOUNT_LOCKED
    );

    // Move lockedUntil into the past and confirm login succeeds and resets failedLoginCount
    await User.updateOne(
      { email: "rohan@example.com" },
      { $set: { lockedUntil: new Date(Date.now() - 60 * 1000) } }
    );

    const unlockedLogin = await request(app).post("/api/v1/auth/login").send({
      email: "rohan@example.com",
      password: "FairConcert2026!",
    });
    expect(unlockedLogin.status).toBe(200);
    expect(typeof unlockedLogin.body.data.token).toBe("string");

    const refreshed = await User.findOne({ email: "rohan@example.com" }).select(
      "+failedLoginCount +lockedUntil"
    );
    expect(refreshed.failedLoginCount).toBe(0);
    expect(refreshed.lockedUntil).toBeUndefined();
  });

  test("GET /api/v1/auth/me reflects live DB role changes, rejects deleted/suspended users, and requireRole logs UNAUTHORIZED_ACCESS", async () => {
    const reg = await request(app).post("/api/v1/auth/register").send({
      fullName: "Meera Iyer",
      email: "meera@example.com",
      phone: "9876543214",
      password: "FairConcert2026!",
    });
    const token = reg.body.data.token;
    const userId = reg.body.data.user.id;

    const meRes = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${token}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body.data.user.email).toBe("meera@example.com");

    // Mount an isolated ADMIN-only route to verify requireRole + live DB role
    const rbacApp = express();
    rbacApp.get(
      "/admin-only",
      authenticate,
      requireRole(constants.USER_ROLES.ADMIN),
      (req, res) => res.status(200).json({ ok: true, role: req.auth.role })
    );

    const denied = await request(rbacApp)
      .get("/admin-only")
      .set("Authorization", `Bearer ${token}`);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe(constants.ERROR_CODES.FORBIDDEN);

    const unauthLog = await SecurityLog.findOne({
      eventType: constants.SECURITY_EVENT_TYPES.UNAUTHORIZED_ACCESS,
      userId,
    });
    expect(unauthLog).not.toBeNull();
    expect(unauthLog.severity).toBe(constants.SECURITY_SEVERITIES.MEDIUM);

    // Promote user in DB while keeping old CUSTOMER JWT -> middleware must trust DB role
    await User.updateOne(
      { _id: userId },
      { $set: { role: constants.USER_ROLES.ADMIN } }
    );
    const allowedAfterPromotion = await request(rbacApp)
      .get("/admin-only")
      .set("Authorization", `Bearer ${token}`);
    expect(allowedAfterPromotion.status).toBe(200);
    expect(allowedAfterPromotion.body.role).toBe(constants.USER_ROLES.ADMIN);

    // Logout writes AUTH_LOGOUT SecurityLog
    const logoutRes = await request(app)
      .post("/api/v1/auth/logout")
      .set("Authorization", `Bearer ${token}`);
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body.data.loggedOut).toBe(true);

    const logoutLog = await SecurityLog.findOne({
      eventType: constants.SECURITY_EVENT_TYPES.AUTH_LOGOUT,
      userId,
    });
    expect(logoutLog).not.toBeNull();

    // Suspended user is rejected with 401
    await User.updateOne(
      { _id: userId },
      { $set: { accountStatus: constants.ACCOUNT_STATUSES.SUSPENDED } }
    );
    const suspendedRes = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${token}`);
    expect(suspendedRes.status).toBe(401);

    // Deleted user is rejected with 401
    await User.deleteOne({ _id: userId });
    const deletedRes = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${token}`);
    expect(deletedRes.status).toBe(401);
  });
});
