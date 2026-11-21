const express = require("express");
const request = require("supertest");
const { ethers } = require("ethers");

const app = require("../src/app");
const config = require("../src/config/env");
const constants = require("../src/config/constants");
const User = require("../src/models/User.model");
const VerificationRecord = require("../src/models/VerificationRecord.model");
const SecurityLog = require("../src/models/SecurityLog.model");
const { signAccessToken } = require("../src/utils/jwt");
const { maskAddress } = require("../src/utils/maskAddress");
const {
  validateWalletAddress,
  validateSignature,
} = require("../src/utils/validators");
const {
  buildChallengeMessage,
} = require("../src/services/wallet/challengeMessage");
const { createWalletRouter } = require("../src/routes/wallet.routes");
const {
  createWalletChallengeLimiter,
  createWalletVerifyLimiter,
} = require("../src/middleware/rateLimit.middleware");
const { authenticate } = require("../src/middleware/auth.middleware");
const { requireRole } = require("../src/middleware/role.middleware");
const {
  requireVerifiedUser,
} = require("../src/middleware/verifiedUser.middleware");
const {
  notFoundHandler,
  errorHandler,
} = require("../src/middleware/errorHandler.middleware");
const { devUnlinkWallet } = require("../scripts/devUnlinkWallet");
const {
  connectTestDb,
  clearTestDb,
  disconnectTestDb,
} = require("./helpers/db");

let userSeq = 0;

async function createCustomer(overrides = {}) {
  userSeq += 1;
  const user = await User.create({
    fullName: `Wallet Fan ${userSeq}`,
    email: `wallet.fan${userSeq}@example.com`,
    phone: `+919876700${String(userSeq).padStart(3, "0")}`,
    passwordHash: "$2a$10$abcdefghijklmnopqrstuv1234567890abcdef",
    role: constants.USER_ROLES.CUSTOMER,
    phoneVerified: true,
    identityVerified: true,
    identityStatus: constants.IDENTITY_STATUSES.VERIFIED,
    identityVerifiedAt: new Date(),
    identityHash: `${String(userSeq).padStart(64, "a")}`,
    ...overrides,
  });
  const token = signAccessToken(user);
  return { user, token };
}

function buildWalletGateApp() {
  const testApp = express();
  testApp.use(express.json());
  testApp.get(
    "/api/v1/test-protected/booking",
    authenticate,
    requireRole(constants.USER_ROLES.CUSTOMER),
    requireVerifiedUser({ requireWallet: true }),
    (req, res) => {
      res.status(200).json({
        success: true,
        data: {
          allowed: true,
          userId: String(req.user._id),
          walletAddress: req.user.walletAddress,
        },
        error: null,
      });
    }
  );
  testApp.use(notFoundHandler);
  testApp.use(errorHandler);
  return testApp;
}

function buildRateLimitedWalletApp({ challengeMax, verifyMax }) {
  const testApp = express();
  testApp.use(express.json());
  testApp.use(
    "/api/v1/wallet",
    createWalletRouter({
      walletChallengeLimiter: createWalletChallengeLimiter({
        max: challengeMax,
      }),
      walletVerifyLimiter: createWalletVerifyLimiter({
        max: verifyMax,
      }),
    })
  );
  testApp.use(notFoundHandler);
  testApp.use(errorHandler);
  return testApp;
}

describe("Wallet Signature Auth Unit & Config Tests (No DB)", () => {
  test("buildChallengeMessage produces deterministic plain-text message with all required fields", () => {
    const wallet = ethers.Wallet.createRandom();
    const checksumAddress = ethers.getAddress(wallet.address);
    const issuedAt = new Date("2026-01-15T10:00:00.000Z");
    const expiresAt = new Date("2026-01-15T10:05:00.000Z");
    const params = {
      domain: "localhost:5173",
      checksumAddress,
      nonce: "0123456789abcdef0123456789abcdef",
      issuedAt,
      expiresAt,
      chainId: 31337,
    };

    const msg1 = buildChallengeMessage(params);
    const msg2 = buildChallengeMessage({
      ...params,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });

    expect(msg1).toBe(msg2);
    expect(msg1).toContain(
      "localhost:5173 wants you to link this wallet to your FairTicket account."
    );
    expect(msg1).toContain(`Wallet: ${checksumAddress}`);
    expect(msg1).toContain(
      "This signature does not cost gas, does not move funds and does not give anyone permission to spend your assets."
    );
    expect(msg1).toContain("Chain ID: 31337");
    expect(msg1).toContain("Nonce: 0123456789abcdef0123456789abcdef");
    expect(msg1).toContain("Issued At: 2026-01-15T10:00:00.000Z");
    expect(msg1).toContain("Expires At: 2026-01-15T10:05:00.000Z");
  });

  test("validateWalletAddress accepts lowercase, uppercase, and valid EIP-55 checksum, and rejects bad checksums or non-strings", () => {
    const wallet = ethers.Wallet.createRandom();
    const checksum = ethers.getAddress(wallet.address);
    const lower = checksum.toLowerCase();
    const upper = `0x${checksum.slice(2).toUpperCase()}`;

    const lowerRes = validateWalletAddress(lower);
    expect(lowerRes.valid).toBe(true);
    expect(lowerRes.value).toBe(lower);
    expect(lowerRes.checksumAddress).toBe(checksum);

    const upperRes = validateWalletAddress(upper);
    expect(upperRes.valid).toBe(true);
    expect(upperRes.value).toBe(lower);
    expect(upperRes.checksumAddress).toBe(checksum);

    const checksumRes = validateWalletAddress(checksum);
    expect(checksumRes.valid).toBe(true);
    expect(checksumRes.value).toBe(lower);
    expect(checksumRes.checksumAddress).toBe(checksum);

    // Flip case of the first alphabetical hex character to break EIP-55 checksum
    const flipped = checksum.replace(/[a-fA-F]/, (ch) =>
      ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase()
    );
    if (
      flipped !== lower &&
      flipped !== upper &&
      flipped !== checksum
    ) {
      const badChecksum = validateWalletAddress(flipped);
      expect(badChecksum.valid).toBe(false);
    }

    for (const bad of [
      "",
      "0x1234",
      "not-an-address",
      "0x" + "g".repeat(40),
      12345,
      null,
      undefined,
      { $ne: "" },
      [lower],
    ]) {
      expect(validateWalletAddress(bad).valid).toBe(false);
    }
  });

  test("validateSignature accepts 65-byte hex signatures and rejects malformed values", () => {
    const validSig = `0x${"ab".repeat(65)}`;
    expect(validateSignature(validSig).valid).toBe(true);

    for (const bad of [
      "",
      "0x1234",
      `0x${"ab".repeat(64)}`,
      `0x${"ab".repeat(66)}`,
      `0x${"zz".repeat(65)}`,
      ` ${validSig} `,
      null,
      123,
      { $ne: null },
    ]) {
      expect(validateSignature(bad).valid).toBe(false);
    }
  });

  test("maskAddress masks full Ethereum addresses to 0x1234...abcd", () => {
    expect(
      maskAddress("0x1234567890abcdef1234567890abcdef1234abcd")
    ).toBe("0x1234...abcd");
    expect(maskAddress("")).toBe("");
    expect(maskAddress(null)).toBe("");
    expect(maskAddress("0x1234")).toBe("0x1234");
  });

  test("buildConfig parses wallet defaults, derives domain from FRONTEND_ORIGIN, and rejects invalid WALLET_* values", () => {
    const baseEnv = {
      NODE_ENV: "test",
      JWT_SECRET: "a".repeat(48),
      IDENTITY_HASH_SECRET: "b".repeat(48),
      FRONTEND_ORIGIN: "https://tickets.fairticket.test:5173/app",
    };

    const cfg = config.buildConfig(baseEnv);
    expect(cfg.wallet).toEqual({
      domain: "tickets.fairticket.test:5173",
      chainId: 31337,
      challengeTtlSeconds: 300,
      maxVerifyAttempts: 5,
      challengeMaxPerHour: 10,
      challengeRateLimitMax: 20,
      verifyRateLimitMax: 30,
    });

    const walletEnvVars = [
      "WALLET_CHAIN_ID",
      "WALLET_CHALLENGE_TTL_SECONDS",
      "WALLET_MAX_VERIFY_ATTEMPTS",
      "WALLET_CHALLENGE_MAX_PER_HOUR",
      "WALLET_CHALLENGE_RATE_LIMIT_MAX",
      "WALLET_VERIFY_RATE_LIMIT_MAX",
    ];

    for (const envName of walletEnvVars) {
      for (const bad of ["0", "-5", "3.14", "abc"]) {
        expect(() =>
          config.buildConfig({
            ...baseEnv,
            [envName]: bad,
          })
        ).toThrow(new RegExp(envName, "i"));
      }
    }
  });

  test("devUnlinkWallet refuses to execute when NODE_ENV=production", async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      await expect(devUnlinkWallet("fan@example.com")).rejects.toThrow(
        /production/i
      );
    } finally {
      process.env.NODE_ENV = prevNodeEnv;
    }
  });

  test("Unauthenticated requests to wallet routes return 401 UNAUTHORIZED", async () => {
    const wallet = ethers.Wallet.createRandom();

    const nonceRes = await request(app)
      .post("/api/v1/wallet/nonce")
      .send({ walletAddress: wallet.address });
    expect(nonceRes.status).toBe(401);
    expect(nonceRes.body.error.code).toBe("UNAUTHORIZED");

    const linkRes = await request(app)
      .post("/api/v1/wallet/link")
      .send({
        walletAddress: wallet.address,
        signature: `0x${"11".repeat(65)}`,
      });
    expect(linkRes.status).toBe(401);
    expect(linkRes.body.error.code).toBe("UNAUTHORIZED");
  });
});

describe("Wallet Signature Auth Integration Tests (MongoDB)", () => {
  beforeAll(async () => {
    await connectTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();
  });

  afterAll(async () => {
    await disconnectTestDb();
  });

  test("Access control and step ordering: role, phoneVerified, and identityStatus are enforced", async () => {
    const wallet = ethers.Wallet.createRandom();

    const { token: adminToken } = await createCustomer({
      role: constants.USER_ROLES.ADMIN,
    });
    const adminRes = await request(app)
      .post("/api/v1/wallet/nonce")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ walletAddress: wallet.address });
    expect(adminRes.status).toBe(403);
    expect(adminRes.body.error.code).toBe("FORBIDDEN");

    const { token: noPhoneToken } = await createCustomer({
      phoneVerified: false,
      identityVerified: false,
      identityStatus: constants.IDENTITY_STATUSES.NOT_STARTED,
      identityHash: undefined,
    });
    const noPhoneRes = await request(app)
      .post("/api/v1/wallet/nonce")
      .set("Authorization", `Bearer ${noPhoneToken}`)
      .send({ walletAddress: wallet.address });
    expect(noPhoneRes.status).toBe(403);
    expect(noPhoneRes.body.error.code).toBe("PHONE_NOT_VERIFIED");

    const { token: noIdToken } = await createCustomer({
      phoneVerified: true,
      identityVerified: false,
      identityStatus: constants.IDENTITY_STATUSES.NOT_STARTED,
      identityHash: undefined,
    });
    const noIdRes = await request(app)
      .post("/api/v1/wallet/nonce")
      .set("Authorization", `Bearer ${noIdToken}`)
      .send({ walletAddress: wallet.address });
    expect(noIdRes.status).toBe(403);
    expect(noIdRes.body.error.code).toBe("IDENTITY_NOT_VERIFIED");
  });

  test("Challenge issuance: format, validation, replacement, no probing, hourly limit, and concurrent boundary race", async () => {
    const { user, token } = await createCustomer();
    const wallet1 = ethers.Wallet.createRandom();
    const wallet2 = ethers.Wallet.createRandom();

    // Unknown field rejected
    const unknownRes = await request(app)
      .post("/api/v1/wallet/nonce")
      .set("Authorization", `Bearer ${token}`)
      .send({ walletAddress: wallet1.address, chainId: 1 });
    expect(unknownRes.status).toBe(400);
    expect(unknownRes.body.error.code).toBe("VALIDATION_ERROR");

    // Invalid address rejected
    const badAddrRes = await request(app)
      .post("/api/v1/wallet/nonce")
      .set("Authorization", `Bearer ${token}`)
      .send({ walletAddress: "0xnotvalid" });
    expect(badAddrRes.status).toBe(400);
    expect(badAddrRes.body.error.code).toBe("VALIDATION_ERROR");

    // Valid challenge
    const ch1 = await request(app)
      .post("/api/v1/wallet/nonce")
      .set("Authorization", `Bearer ${token}`)
      .send({ walletAddress: wallet1.address.toLowerCase() });
    expect(ch1.status).toBe(200);
    expect(ch1.body.success).toBe(true);
    expect(ch1.body.data.walletAddress).toBe(ethers.getAddress(wallet1.address));
    expect(ch1.body.data.chainId).toBe(config.wallet.chainId);
    expect(ch1.body.data.expiresInSeconds).toBe(
      config.wallet.challengeTtlSeconds
    );
    expect(ch1.body.data.message).toContain(ch1.body.data.nonce);
    expect(ch1.body.data.message).toContain(ethers.getAddress(wallet1.address));

    // Requesting another challenge replaces the previous one
    const ch2 = await request(app)
      .post("/api/v1/wallet/nonce")
      .set("Authorization", `Bearer ${token}`)
      .send({ walletAddress: wallet2.address });
    expect(ch2.status).toBe(200);
    expect(ch2.body.data.nonce).not.toBe(ch1.body.data.nonce);

    // Previous signature against ch1 is rejected because ch2 replaced it
    const oldSig = await wallet1.signMessage(ch1.body.data.message);
    const oldVerify = await request(app)
      .post("/api/v1/wallet/link")
      .set("Authorization", `Bearer ${token}`)
      .send({ walletAddress: wallet1.address, signature: oldSig });
    expect(oldVerify.status).toBe(400);
    expect(oldVerify.body.error.code).toBe("WALLET_CHALLENGE_MISMATCH");

    // Concurrent race at rolling hourly limit boundary
    // Already used 2 of WALLET_CHALLENGE_MAX_PER_HOUR (10); set count to max - 2 and fire 4 concurrently
    await VerificationRecord.updateOne(
      {
        userId: user._id,
        verificationType: constants.VERIFICATION_TYPES.WALLET_PROOF,
      },
      {
        $set: {
          walletChallengeCount: config.wallet.challengeMaxPerHour - 2,
          walletChallengeWindowStartedAt: new Date(),
        },
      }
    );

    const raceResults = await Promise.all([
      request(app)
        .post("/api/v1/wallet/nonce")
        .set("Authorization", `Bearer ${token}`)
        .send({ walletAddress: wallet2.address }),
      request(app)
        .post("/api/v1/wallet/nonce")
        .set("Authorization", `Bearer ${token}`)
        .send({ walletAddress: wallet2.address }),
      request(app)
        .post("/api/v1/wallet/nonce")
        .set("Authorization", `Bearer ${token}`)
        .send({ walletAddress: wallet2.address }),
      request(app)
        .post("/api/v1/wallet/nonce")
        .set("Authorization", `Bearer ${token}`)
        .send({ walletAddress: wallet2.address }),
    ]);

    const raceStatuses = raceResults.map((r) => r.status).sort((a, b) => a - b);
    expect(raceStatuses).toEqual([200, 200, 429, 429]);
    for (const limited of raceResults.filter((r) => r.status === 429)) {
      expect(limited.body.error.code).toBe("WALLET_CHALLENGE_LIMIT");
    }
  });

  test("Full verification flow: mixed-case address, lowercase storage, verification status, gate unlock, and cannot link second wallet", async () => {
    const { user, token } = await createCustomer();
    const wallet = ethers.Wallet.createRandom();
    const otherWallet = ethers.Wallet.createRandom();
    const checksumAddress = ethers.getAddress(wallet.address);

    // Before linking: requireVerifiedUser({ requireWallet: true }) blocks with WALLET_NOT_LINKED
    const gateApp = buildWalletGateApp();
    const beforeGate = await request(gateApp)
      .get("/api/v1/test-protected/booking")
      .set("Authorization", `Bearer ${token}`);
    expect(beforeGate.status).toBe(403);
    expect(beforeGate.body.error.code).toBe("WALLET_NOT_LINKED");

    const chRes = await request(app)
      .post("/api/v1/wallet/nonce")
      .set("Authorization", `Bearer ${token}`)
      .send({ walletAddress: checksumAddress });
    expect(chRes.status).toBe(200);

    const signature = await wallet.signMessage(chRes.body.data.message);
    const linkRes = await request(app)
      .post("/api/v1/wallet/link")
      .set("Authorization", `Bearer ${token}`)
      .send({ walletAddress: checksumAddress, signature });

    expect(linkRes.status).toBe(200);
    expect(linkRes.body.data.walletAddress).toBe(wallet.address.toLowerCase());
    expect(linkRes.body.data.linkedAt).toBeTruthy();

    // Verify DB state
    const dbUser = await User.findById(user._id);
    expect(dbUser.walletLinked).toBe(true);
    expect(dbUser.walletAddress).toBe(wallet.address.toLowerCase());
    expect(dbUser.walletLinkedAt).toBeInstanceOf(Date);

    // Verification status exposes wallet info and never exposes nonce or challenge attempts
    const statusRes = await request(app)
      .get("/api/v1/verification/status")
      .set("Authorization", `Bearer ${token}`);
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.data.wallet.linked).toBe(true);
    expect(statusRes.body.data.wallet.walletAddress).toBe(
      wallet.address.toLowerCase()
    );
    expect(statusRes.body.data.wallet.linkedAt).toBeTruthy();
    expect(JSON.stringify(statusRes.body)).not.toContain(chRes.body.data.nonce);

    // After linking: requireVerifiedUser({ requireWallet: true }) passes
    const afterGate = await request(gateApp)
      .get("/api/v1/test-protected/booking")
      .set("Authorization", `Bearer ${token}`);
    expect(afterGate.status).toBe(200);
    expect(afterGate.body.data.allowed).toBe(true);

    // User cannot request a challenge for a second wallet
    const secondChallenge = await request(app)
      .post("/api/v1/wallet/nonce")
      .set("Authorization", `Bearer ${token}`)
      .send({ walletAddress: otherWallet.address });
    expect(secondChallenge.status).toBe(409);
    expect(secondChallenge.body.error.code).toBe("ACCOUNT_ALREADY_HAS_WALLET");

    // Replaying own signature after linking fails
    const replayOwn = await request(app)
      .post("/api/v1/wallet/link")
      .set("Authorization", `Bearer ${token}`)
      .send({ walletAddress: checksumAddress, signature });
    expect(replayOwn.status).toBe(409);
    expect(replayOwn.body.error.code).toBe("ACCOUNT_ALREADY_HAS_WALLET");
  });

  test("Verification rejections: not requested, unknown fields, wrong signer, different message, garbage sig, lockout + unlock, expiry", async () => {
    const { user, token } = await createCustomer();
    const walletA = ethers.Wallet.createRandom();
    const walletWrong = ethers.Wallet.createRandom();

    // Verify before requesting challenge
    const noChRes = await request(app)
      .post("/api/v1/wallet/link")
      .set("Authorization", `Bearer ${token}`)
      .send({
        walletAddress: walletA.address,
        signature: `0x${"aa".repeat(65)}`,
      });
    expect(noChRes.status).toBe(400);
    expect(noChRes.body.error.code).toBe("WALLET_CHALLENGE_NOT_REQUESTED");

    // Request challenge
    const chRes = await request(app)
      .post("/api/v1/wallet/nonce")
      .set("Authorization", `Bearer ${token}`)
      .send({ walletAddress: walletA.address });
    expect(chRes.status).toBe(200);

    // Client-supplied message or nonce is strictly rejected
    const withMsgRes = await request(app)
      .post("/api/v1/wallet/link")
      .set("Authorization", `Bearer ${token}`)
      .send({
        walletAddress: walletA.address,
        signature: `0x${"aa".repeat(65)}`,
        message: chRes.body.data.message,
      });
    expect(withMsgRes.status).toBe(400);
    expect(withMsgRes.body.error.code).toBe("VALIDATION_ERROR");

    const withNonceRes = await request(app)
      .post("/api/v1/wallet/link")
      .set("Authorization", `Bearer ${token}`)
      .send({
        walletAddress: walletA.address,
        signature: `0x${"aa".repeat(65)}`,
        nonce: chRes.body.data.nonce,
      });
    expect(withNonceRes.status).toBe(400);
    expect(withNonceRes.body.error.code).toBe("VALIDATION_ERROR");

    // Malformed signature -> 400 VALIDATION_ERROR (never 500)
    const malformedSig = await request(app)
      .post("/api/v1/wallet/link")
      .set("Authorization", `Bearer ${token}`)
      .send({
        walletAddress: walletA.address,
        signature: "0x1234",
      });
    expect(malformedSig.status).toBe(400);
    expect(malformedSig.body.error.code).toBe("VALIDATION_ERROR");

    // Attempt 1: valid-format garbage signature -> 400 WALLET_SIGNATURE_INVALID (never 500)
    const garbageSig = await request(app)
      .post("/api/v1/wallet/link")
      .set("Authorization", `Bearer ${token}`)
      .send({
        walletAddress: walletA.address,
        signature: `0x${"00".repeat(65)}`,
      });
    expect(garbageSig.status).toBe(400);
    expect(garbageSig.body.error.code).toBe("WALLET_SIGNATURE_INVALID");
    expect(garbageSig.body.error.details.attemptsRemaining).toBe(
      config.wallet.maxVerifyAttempts - 1
    );

    // Attempt 2: wrong signer
    const wrongSignerSig = await walletWrong.signMessage(chRes.body.data.message);
    const wrongSignerRes = await request(app)
      .post("/api/v1/wallet/link")
      .set("Authorization", `Bearer ${token}`)
      .send({
        walletAddress: walletA.address,
        signature: wrongSignerSig,
      });
    expect(wrongSignerRes.status).toBe(400);
    expect(wrongSignerRes.body.error.code).toBe("WALLET_SIGNATURE_INVALID");
    expect(wrongSignerRes.body.error.details.attemptsRemaining).toBe(
      config.wallet.maxVerifyAttempts - 2
    );

    // Attempt 3: signed different message with right wallet
    const diffMsgSig = await walletA.signMessage("some other message");
    const diffMsgRes = await request(app)
      .post("/api/v1/wallet/link")
      .set("Authorization", `Bearer ${token}`)
      .send({
        walletAddress: walletA.address,
        signature: diffMsgSig,
      });
    expect(diffMsgRes.status).toBe(400);
    expect(diffMsgRes.body.error.code).toBe("WALLET_SIGNATURE_INVALID");

    // Exhaust remaining attempts until locked
    let lastStatus = null;
    let lastCode = null;
    for (let i = 3; i < config.wallet.maxVerifyAttempts; i += 1) {
      const r = await request(app)
        .post("/api/v1/wallet/link")
        .set("Authorization", `Bearer ${token}`)
        .send({
          walletAddress: walletA.address,
          signature: wrongSignerSig,
        });
      lastStatus = r.status;
      lastCode = r.body.error.code;
    }
    expect(lastStatus).toBe(429);
    expect(lastCode).toBe("WALLET_CHALLENGE_LOCKED");

    // Even valid signature fails while locked
    const validSigForLocked = await walletA.signMessage(chRes.body.data.message);
    const stillLocked = await request(app)
      .post("/api/v1/wallet/link")
      .set("Authorization", `Bearer ${token}`)
      .send({
        walletAddress: walletA.address,
        signature: validSigForLocked,
      });
    expect(stillLocked.status).toBe(429);
    expect(stillLocked.body.error.code).toBe("WALLET_CHALLENGE_LOCKED");

    // Requesting a new challenge unlocks and resets attempts
    const freshCh = await request(app)
      .post("/api/v1/wallet/nonce")
      .set("Authorization", `Bearer ${token}`)
      .send({ walletAddress: walletA.address });
    expect(freshCh.status).toBe(200);

    // Expire the challenge in DB and confirm WALLET_CHALLENGE_EXPIRED
    await VerificationRecord.updateOne(
      {
        userId: user._id,
        verificationType: constants.VERIFICATION_TYPES.WALLET_PROOF,
      },
      { $set: { walletChallengeExpiresAt: new Date(Date.now() - 1000) } }
    );
    const expiredSig = await walletA.signMessage(freshCh.body.data.message);
    const expiredRes = await request(app)
      .post("/api/v1/wallet/link")
      .set("Authorization", `Bearer ${token}`)
      .send({
        walletAddress: walletA.address,
        signature: expiredSig,
      });
    expect(expiredRes.status).toBe(400);
    expect(expiredRes.body.error.code).toBe("WALLET_CHALLENGE_EXPIRED");
  });

  test("Replay protection, multi-user wallet uniqueness race, zero info leakage, and clean SecurityLogs", async () => {
    const { user: userA, token: tokenA } = await createCustomer({
      fullName: "Alice Secret",
      email: "alice.secret@example.com",
    });
    const { user: userB, token: tokenB } = await createCustomer({
      fullName: "Bob Rival",
      email: "bob.rival@example.com",
    });

    const sharedWallet = ethers.Wallet.createRandom();

    // Both users can request a challenge for the same wallet (no wallet probing on /nonce)
    const [chA, chB] = await Promise.all([
      request(app)
        .post("/api/v1/wallet/nonce")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ walletAddress: sharedWallet.address }),
      request(app)
        .post("/api/v1/wallet/nonce")
        .set("Authorization", `Bearer ${tokenB}`)
        .send({ walletAddress: sharedWallet.address }),
    ]);
    expect(chA.status).toBe(200);
    expect(chB.status).toBe(200);

    const sigA = await sharedWallet.signMessage(chA.body.data.message);
    const sigB = await sharedWallet.signMessage(chB.body.data.message);

    // User B trying to replay User A's signature fails because nonces differ
    const replayFromA = await request(app)
      .post("/api/v1/wallet/link")
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ walletAddress: sharedWallet.address, signature: sigA });
    expect(replayFromA.status).toBe(400);
    expect(replayFromA.body.error.code).toBe("WALLET_SIGNATURE_INVALID");

    // Race both valid signatures concurrently for the same wallet
    const [resA, resB] = await Promise.all([
      request(app)
        .post("/api/v1/wallet/link")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ walletAddress: sharedWallet.address, signature: sigA }),
      request(app)
        .post("/api/v1/wallet/link")
        .set("Authorization", `Bearer ${tokenB}`)
        .send({ walletAddress: sharedWallet.address, signature: sigB }),
    ]);

    expect([resA.status, resB.status].sort((a, b) => a - b)).toEqual([
      200, 409,
    ]);

    const loserRes = resA.status === 409 ? resA : resB;
    const winnerUser = resA.status === 200 ? userA : userB;
    expect(loserRes.body.error.code).toBe("WALLET_ALREADY_LINKED");

    // Loser response must NEVER leak winner's email, name, or userId
    const loserBodyStr = JSON.stringify(loserRes.body);
    expect(loserBodyStr).not.toContain(winnerUser.email);
    expect(loserBodyStr).not.toContain(winnerUser.fullName);
    expect(loserBodyStr).not.toContain(String(winnerUser._id));

    // SecurityLog privacy sweep: zero signatures, nonces, or full wallet addresses
    const allLogs = await SecurityLog.find({}).lean();
    expect(allLogs.length).toBeGreaterThan(0);

    const conflictLog = allLogs.find(
      (log) =>
        log.eventType ===
        constants.SECURITY_EVENT_TYPES.WALLET_ALREADY_LINKED_ATTEMPT
    );
    expect(conflictLog).toBeTruthy();
    expect(conflictLog.severity).toBe(constants.SECURITY_SEVERITIES.HIGH);
    expect(conflictLog.details.conflictingUserId).toBe(String(winnerUser._id));

    const serializedLogs = JSON.stringify(allLogs);
    expect(serializedLogs).not.toContain(sigA);
    expect(serializedLogs).not.toContain(sigB);
    expect(serializedLogs).not.toContain(chA.body.data.nonce);
    expect(serializedLogs).not.toContain(chB.body.data.nonce);
    expect(serializedLogs.toLowerCase()).not.toContain(
      sharedWallet.address.toLowerCase()
    );

    // Concurrent same-user verify race on a fresh user -> only 1 succeeds
    const { token: soloToken } = await createCustomer();
    const soloWallet = ethers.Wallet.createRandom();
    const soloCh = await request(app)
      .post("/api/v1/wallet/nonce")
      .set("Authorization", `Bearer ${soloToken}`)
      .send({ walletAddress: soloWallet.address });
    const soloSig = await soloWallet.signMessage(soloCh.body.data.message);

    const [solo1, solo2] = await Promise.all([
      request(app)
        .post("/api/v1/wallet/link")
        .set("Authorization", `Bearer ${soloToken}`)
        .send({ walletAddress: soloWallet.address, signature: soloSig }),
      request(app)
        .post("/api/v1/wallet/link")
        .set("Authorization", `Bearer ${soloToken}`)
        .send({ walletAddress: soloWallet.address, signature: soloSig }),
    ]);

    const soloStatuses = [solo1.status, solo2.status].sort((a, b) => a - b);
    expect(soloStatuses[0]).toBe(200);
    expect([400, 409]).toContain(soloStatuses[1]);
  });

  test("Rate limiters enforce 429 RATE_LIMITED on wallet challenge and link endpoints", async () => {
    const { token } = await createCustomer();
    const wallet = ethers.Wallet.createRandom();
    const limitedApp = buildRateLimitedWalletApp({
      challengeMax: 2,
      verifyMax: 2,
    });

    const c1 = await request(limitedApp)
      .post("/api/v1/wallet/nonce")
      .set("Authorization", `Bearer ${token}`)
      .send({ walletAddress: wallet.address });
    const c2 = await request(limitedApp)
      .post("/api/v1/wallet/nonce")
      .set("Authorization", `Bearer ${token}`)
      .send({ walletAddress: wallet.address });
    const c3 = await request(limitedApp)
      .post("/api/v1/wallet/nonce")
      .set("Authorization", `Bearer ${token}`)
      .send({ walletAddress: wallet.address });

    expect(c1.status).toBe(200);
    expect(c2.status).toBe(200);
    expect(c3.status).toBe(429);
    expect(c3.body.error.code).toBe("RATE_LIMITED");

    const badSig = `0x${"00".repeat(65)}`;
    const v1 = await request(limitedApp)
      .post("/api/v1/wallet/link")
      .set("Authorization", `Bearer ${token}`)
      .send({ walletAddress: wallet.address, signature: badSig });
    const v2 = await request(limitedApp)
      .post("/api/v1/wallet/link")
      .set("Authorization", `Bearer ${token}`)
      .send({ walletAddress: wallet.address, signature: badSig });
    const v3 = await request(limitedApp)
      .post("/api/v1/wallet/link")
      .set("Authorization", `Bearer ${token}`)
      .send({ walletAddress: wallet.address, signature: badSig });

    expect(v1.status).toBe(400);
    expect(v2.status).toBe(400);
    expect(v3.status).toBe(429);
    expect(v3.body.error.code).toBe("RATE_LIMITED");
  });

  test("devUnlinkWallet unlinks wallet in non-production, logs masked address, and allows re-linking", async () => {
    const { user, token } = await createCustomer();
    const wallet1 = ethers.Wallet.createRandom();
    const wallet2 = ethers.Wallet.createRandom();

    const ch1 = await request(app)
      .post("/api/v1/wallet/nonce")
      .set("Authorization", `Bearer ${token}`)
      .send({ walletAddress: wallet1.address });
    const sig1 = await wallet1.signMessage(ch1.body.data.message);
    const link1 = await request(app)
      .post("/api/v1/wallet/link")
      .set("Authorization", `Bearer ${token}`)
      .send({ walletAddress: wallet1.address, signature: sig1 });
    expect(link1.status).toBe(200);

    const unlinkResult = await devUnlinkWallet(user.email);
    expect(unlinkResult.unlinked).toBe(true);
    expect(unlinkResult.hadLinkedWallet).toBe(true);
    expect(unlinkResult.maskedAddress).toBe(
      maskAddress(wallet1.address.toLowerCase())
    );

    const dbUserAfterUnlink = await User.findById(user._id);
    expect(dbUserAfterUnlink.walletLinked).toBe(false);
    expect(dbUserAfterUnlink.walletAddress).toBeUndefined();
    expect(dbUserAfterUnlink.walletLinkedAt).toBeUndefined();

    const unlinkLog = await SecurityLog.findOne({
      userId: user._id,
      eventType: constants.SECURITY_EVENT_TYPES.DEV_WALLET_UNLINKED,
    }).lean();
    expect(unlinkLog).toBeTruthy();
    expect(JSON.stringify(unlinkLog).toLowerCase()).not.toContain(
      wallet1.address.toLowerCase()
    );

    // User can now link wallet2
    const ch2 = await request(app)
      .post("/api/v1/wallet/nonce")
      .set("Authorization", `Bearer ${token}`)
      .send({ walletAddress: wallet2.address });
    expect(ch2.status).toBe(200);
    const sig2 = await wallet2.signMessage(ch2.body.data.message);
    const link2 = await request(app)
      .post("/api/v1/wallet/link")
      .set("Authorization", `Bearer ${token}`)
      .send({ walletAddress: wallet2.address, signature: sig2 });
    expect(link2.status).toBe(200);
    expect(link2.body.data.walletAddress).toBe(wallet2.address.toLowerCase());
  });
});
