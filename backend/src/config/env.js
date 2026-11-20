const path = require("path");
const dotenv = require("dotenv");

if (process.env.NODE_ENV !== "test") {
  dotenv.config({ path: path.resolve(__dirname, "../../.env") });
}

function parsePositiveInt(rawValue, fallback, varName) {
  if (rawValue === undefined || rawValue === "") {
    return fallback;
  }
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `Invalid configuration: ${varName} must be a positive integer (received "${rawValue}").`
    );
  }
  return parsed;
}

const jwtSecret = process.env.JWT_SECRET ? process.env.JWT_SECRET.trim() : "";

if (!jwtSecret || jwtSecret.length < 32) {
  throw new Error(
    [
      "Invalid configuration: JWT_SECRET is missing or shorter than 32 characters.",
      "Create backend/.env from backend/.env.example and generate a strong secret with:",
      '  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"',
    ].join("\n")
  );
}

const identityHashSecret = process.env.IDENTITY_HASH_SECRET
  ? process.env.IDENTITY_HASH_SECRET.trim()
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

const ALLOWED_IDENTITY_PROVIDERS = ["mock"];
const identityProvider = (process.env.IDENTITY_PROVIDER || "mock")
  .trim()
  .toLowerCase();

if (!ALLOWED_IDENTITY_PROVIDERS.includes(identityProvider)) {
  throw new Error(
    `Invalid configuration: IDENTITY_PROVIDER must be one of [${ALLOWED_IDENTITY_PROVIDERS.join(
      ", "
    )}] (received "${process.env.IDENTITY_PROVIDER}").`
  );
}

const config = Object.freeze({
  port: parsePositiveInt(process.env.PORT, 5000, "PORT"),
  nodeEnv: process.env.NODE_ENV || "development",
  frontendOrigin: process.env.FRONTEND_ORIGIN || "http://localhost:5173",
  mongodbUri: process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/fairticket",
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "12h",
  identityHashSecret,
  identityProvider,
  identityMaxAttemptsPerDay: parsePositiveInt(
    process.env.IDENTITY_MAX_ATTEMPTS_PER_DAY,
    5,
    "IDENTITY_MAX_ATTEMPTS_PER_DAY"
  ),
  identitySubmitRateLimitMax: parsePositiveInt(
    process.env.IDENTITY_SUBMIT_RATE_LIMIT_MAX,
    10,
    "IDENTITY_SUBMIT_RATE_LIMIT_MAX"
  ),
  identityHashSalt: process.env.IDENTITY_HASH_SALT || "",
  otpHashSalt: process.env.OTP_HASH_SALT || "",
  qrSigningSecret: process.env.QR_SIGNING_SECRET || "",
  hardhatRpcUrl: process.env.HARDHAT_RPC_URL || "http://127.0.0.1:8545",
  chainId: parsePositiveInt(process.env.CHAIN_ID, 31337, "CHAIN_ID"),
  fairTicketContractAddress: process.env.FAIRTICKET_CONTRACT_ADDRESS || "",
  verifierPrivateKey: process.env.VERIFIER_PRIVATE_KEY || "",
  organizerPrivateKey: process.env.ORGANIZER_PRIVATE_KEY || "",
  gatePrivateKey: process.env.GATE_PRIVATE_KEY || "",
  trustGuardianExplainerMode:
    process.env.TRUST_GUARDIAN_EXPLAINER_MODE || "DETERMINISTIC_TEMPLATE",
  rateLimit: Object.freeze({
    windowMs: parsePositiveInt(
      process.env.RATE_LIMIT_WINDOW_MS,
      15 * 60 * 1000,
      "RATE_LIMIT_WINDOW_MS"
    ),
    maxRequests: parsePositiveInt(
      process.env.RATE_LIMIT_MAX_REQUESTS,
      300,
      "RATE_LIMIT_MAX_REQUESTS"
    ),
  }),
});

module.exports = config;
