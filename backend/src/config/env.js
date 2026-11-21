const path = require("path");
const dotenv = require("dotenv");

if (process.env.NODE_ENV !== "test") {
  dotenv.config({ path: path.resolve(__dirname, "../../.env") });
}

function parsePositiveInt(rawValue, fallback, varName, bounds = {}) {
  if (rawValue === undefined || rawValue === "") {
    return fallback;
  }
  const parsed = Number.parseInt(String(rawValue), 10);
  if (
    !Number.isInteger(parsed) ||
    parsed <= 0 ||
    String(parsed) !== String(rawValue).trim()
  ) {
    throw new Error(
      `Invalid configuration: ${varName} must be a positive integer (received "${rawValue}").`
    );
  }
  if (bounds.min !== undefined && parsed < bounds.min) {
    throw new Error(
      `Invalid configuration: ${varName} must be at least ${bounds.min} (received ${parsed}).`
    );
  }
  if (bounds.max !== undefined && parsed > bounds.max) {
    throw new Error(
      `Invalid configuration: ${varName} must be at most ${bounds.max} (received ${parsed}).`
    );
  }
  return parsed;
}

function parseBoolean(rawValue, fallback) {
  if (rawValue === undefined || rawValue === "") {
    return fallback;
  }
  const normalized = String(rawValue).trim().toLowerCase();
  if (normalized === "true" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "0") {
    return false;
  }
  return fallback;
}

const ALLOWED_IDENTITY_PROVIDERS = ["mock"];
const ALLOWED_SMS_PROVIDERS = ["console", "mock"];

function deriveSigningDomain(frontendOrigin) {
  try {
    const parsed = new URL(frontendOrigin);
    return parsed.host || "localhost:5173";
  } catch (_err) {
    return "localhost:5173";
  }
}

function buildConfig(envSource = process.env, options = {}) {
  const warn =
    typeof options.warn === "function" ? options.warn : console.warn;

  const nodeEnv = (envSource.NODE_ENV || "development").trim();

  const jwtSecret = envSource.JWT_SECRET ? envSource.JWT_SECRET.trim() : "";
  if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error(
      [
        "Invalid configuration: JWT_SECRET is missing or shorter than 32 characters.",
        "Create backend/.env from backend/.env.example and generate a strong secret with:",
        '  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"',
      ].join("\n")
    );
  }

  const identityHashSecret = envSource.IDENTITY_HASH_SECRET
    ? envSource.IDENTITY_HASH_SECRET.trim()
    : "";

  if (!identityHashSecret || identityHashSecret.length < 32) {
    throw new Error(
      [
        "Invalid configuration: IDENTITY_HASH_SECRET is missing or shorter than 32 characters.",
        "Create backend/.env from backend/.env.example and generate a strong secret with:",
        '  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"',
      ].join("\n")
    );
  }

  if (identityHashSecret === jwtSecret) {
    throw new Error(
      "Invalid configuration: IDENTITY_HASH_SECRET must be different from JWT_SECRET."
    );
  }

  const identityProvider = (envSource.IDENTITY_PROVIDER || "mock")
    .trim()
    .toLowerCase();

  if (!ALLOWED_IDENTITY_PROVIDERS.includes(identityProvider)) {
    throw new Error(
      `Invalid configuration: IDENTITY_PROVIDER must be one of [${ALLOWED_IDENTITY_PROVIDERS.join(
        ", "
      )}] (received "${envSource.IDENTITY_PROVIDER}").`
    );
  }

  const smsProvider = (envSource.SMS_PROVIDER || "console")
    .trim()
    .toLowerCase();

  if (!ALLOWED_SMS_PROVIDERS.includes(smsProvider)) {
    throw new Error(
      `Invalid configuration: SMS_PROVIDER must be one of [${ALLOWED_SMS_PROVIDERS.join(
        ", "
      )}] (received "${envSource.SMS_PROVIDER}").`
    );
  }

  const rawDemoShowOtp = parseBoolean(envSource.DEMO_SHOW_OTP, false);
  let demoShowOtp = rawDemoShowOtp;
  if (nodeEnv === "production" && rawDemoShowOtp) {
    demoShowOtp = false;
    warn(
      "[FairTicket Config Warning] DEMO_SHOW_OTP=true is forbidden in NODE_ENV=production and has been forced to false."
    );
  }

  return Object.freeze({
    port: parsePositiveInt(envSource.PORT, 5000, "PORT", {
      min: 1,
      max: 65535,
    }),
    nodeEnv,
    frontendOrigin: envSource.FRONTEND_ORIGIN || "http://localhost:5173",
    mongodbUri:
      envSource.MONGODB_URI || "mongodb://127.0.0.1:27017/fairticket",
    jwtSecret,
    jwtExpiresIn: envSource.JWT_EXPIRES_IN || "12h",
    jwtIssuer: (envSource.JWT_ISSUER || "fairticket").trim(),
    jwtAudience: (envSource.JWT_AUDIENCE || "fairticket-web").trim(),
    auth: Object.freeze({
      maxFailedLogins: parsePositiveInt(
        envSource.AUTH_MAX_FAILED_LOGINS,
        5,
        "AUTH_MAX_FAILED_LOGINS",
        { min: 1, max: 50 }
      ),
      lockMinutes: parsePositiveInt(
        envSource.AUTH_LOCK_MINUTES,
        15,
        "AUTH_LOCK_MINUTES",
        { min: 1, max: 1440 }
      ),
      loginRateLimitMax: parsePositiveInt(
        envSource.AUTH_LOGIN_RATE_LIMIT_MAX,
        10,
        "AUTH_LOGIN_RATE_LIMIT_MAX",
        { min: 1, max: 1000 }
      ),
      registerRateLimitMax: parsePositiveInt(
        envSource.AUTH_REGISTER_RATE_LIMIT_MAX,
        5,
        "AUTH_REGISTER_RATE_LIMIT_MAX",
        { min: 1, max: 1000 }
      ),
    }),
    otp: Object.freeze({
      length: parsePositiveInt(envSource.OTP_LENGTH, 6, "OTP_LENGTH", {
        min: 4,
        max: 10,
      }),
      ttlSeconds: parsePositiveInt(
        envSource.OTP_TTL_SECONDS,
        300,
        "OTP_TTL_SECONDS",
        { min: 30, max: 3600 }
      ),
      maxAttempts: parsePositiveInt(
        envSource.OTP_MAX_ATTEMPTS,
        5,
        "OTP_MAX_ATTEMPTS",
        { min: 1, max: 20 }
      ),
      resendCooldownSeconds: parsePositiveInt(
        envSource.OTP_RESEND_COOLDOWN_SECONDS,
        30,
        "OTP_RESEND_COOLDOWN_SECONDS",
        { min: 1, max: 600 }
      ),
      maxSendsPerHour: parsePositiveInt(
        envSource.OTP_MAX_SENDS_PER_HOUR,
        5,
        "OTP_MAX_SENDS_PER_HOUR",
        { min: 1, max: 50 }
      ),
      sendRateLimitMax: parsePositiveInt(
        envSource.OTP_SEND_RATE_LIMIT_MAX,
        10,
        "OTP_SEND_RATE_LIMIT_MAX",
        { min: 1, max: 500 }
      ),
      verifyRateLimitMax: parsePositiveInt(
        envSource.OTP_VERIFY_RATE_LIMIT_MAX,
        30,
        "OTP_VERIFY_RATE_LIMIT_MAX",
        { min: 1, max: 500 }
      ),
      smsProvider,
      demoShowOtp,
    }),
    identityHashSecret,
    identityProvider,
    identityMaxAttemptsPerDay: parsePositiveInt(
      envSource.IDENTITY_MAX_ATTEMPTS_PER_DAY,
      5,
      "IDENTITY_MAX_ATTEMPTS_PER_DAY",
      { min: 1, max: 100 }
    ),
    identitySubmitRateLimitMax: parsePositiveInt(
      envSource.IDENTITY_SUBMIT_RATE_LIMIT_MAX,
      10,
      "IDENTITY_SUBMIT_RATE_LIMIT_MAX",
      { min: 1, max: 500 }
    ),
    identityDuplicateFlagThreshold: parsePositiveInt(
      envSource.IDENTITY_DUPLICATE_FLAG_THRESHOLD,
      3,
      "IDENTITY_DUPLICATE_FLAG_THRESHOLD",
      { min: 1, max: 20 }
    ),
    wallet: Object.freeze({
      domain: deriveSigningDomain(
        envSource.FRONTEND_ORIGIN || "http://localhost:5173"
      ),
      chainId: parsePositiveInt(
        envSource.WALLET_CHAIN_ID,
        31337,
        "WALLET_CHAIN_ID",
        { min: 1, max: 2147483647 }
      ),
      challengeTtlSeconds: parsePositiveInt(
        envSource.WALLET_CHALLENGE_TTL_SECONDS,
        300,
        "WALLET_CHALLENGE_TTL_SECONDS",
        { min: 30, max: 3600 }
      ),
      maxVerifyAttempts: parsePositiveInt(
        envSource.WALLET_MAX_VERIFY_ATTEMPTS,
        5,
        "WALLET_MAX_VERIFY_ATTEMPTS",
        { min: 1, max: 20 }
      ),
      challengeMaxPerHour: parsePositiveInt(
        envSource.WALLET_CHALLENGE_MAX_PER_HOUR,
        10,
        "WALLET_CHALLENGE_MAX_PER_HOUR",
        { min: 1, max: 100 }
      ),
      challengeRateLimitMax: parsePositiveInt(
        envSource.WALLET_CHALLENGE_RATE_LIMIT_MAX,
        20,
        "WALLET_CHALLENGE_RATE_LIMIT_MAX",
        { min: 1, max: 500 }
      ),
      verifyRateLimitMax: parsePositiveInt(
        envSource.WALLET_VERIFY_RATE_LIMIT_MAX,
        30,
        "WALLET_VERIFY_RATE_LIMIT_MAX",
        { min: 1, max: 500 }
      ),
    }),
    events: Object.freeze({
      writeRateLimitMax: parsePositiveInt(
        envSource.EVENT_WRITE_RATE_LIMIT_MAX,
        60,
        "EVENT_WRITE_RATE_LIMIT_MAX",
        { min: 1, max: 1000 }
      ),
      readRateLimitMax: parsePositiveInt(
        envSource.EVENT_READ_RATE_LIMIT_MAX,
        200,
        "EVENT_READ_RATE_LIMIT_MAX",
        { min: 1, max: 5000 }
      ),
    }),
    identityHashSalt: envSource.IDENTITY_HASH_SALT || "",
    otpHashSalt: envSource.OTP_HASH_SALT || "",
    qrSigningSecret: envSource.QR_SIGNING_SECRET || "",
    hardhatRpcUrl: envSource.HARDHAT_RPC_URL || "http://127.0.0.1:8545",
    chainId: parsePositiveInt(envSource.CHAIN_ID, 31337, "CHAIN_ID"),
    fairTicketContractAddress: envSource.FAIRTICKET_CONTRACT_ADDRESS || "",
    verifierPrivateKey: envSource.VERIFIER_PRIVATE_KEY || "",
    organizerPrivateKey: envSource.ORGANIZER_PRIVATE_KEY || "",
    gatePrivateKey: envSource.GATE_PRIVATE_KEY || "",
    trustGuardianExplainerMode:
      envSource.TRUST_GUARDIAN_EXPLAINER_MODE || "DETERMINISTIC_TEMPLATE",
    rateLimit: Object.freeze({
      windowMs: parsePositiveInt(
        envSource.RATE_LIMIT_WINDOW_MS,
        15 * 60 * 1000,
        "RATE_LIMIT_WINDOW_MS"
      ),
      maxRequests: parsePositiveInt(
        envSource.RATE_LIMIT_MAX_REQUESTS,
        300,
        "RATE_LIMIT_MAX_REQUESTS"
      ),
    }),
  });
}

const config = buildConfig(process.env);

module.exports = Object.assign(Object.create(null), config, { buildConfig });
