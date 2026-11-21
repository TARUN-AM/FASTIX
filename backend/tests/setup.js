process.env.NODE_ENV = "test";

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.trim().length < 32) {
  process.env.JWT_SECRET =
    "test_only_jwt_secret_key_for_fairticket_backend_test_suite_000001";
}

if (
  !process.env.IDENTITY_HASH_SECRET ||
  process.env.IDENTITY_HASH_SECRET.trim().length < 32 ||
  process.env.IDENTITY_HASH_SECRET.trim() === process.env.JWT_SECRET.trim()
) {
  process.env.IDENTITY_HASH_SECRET =
    "test_only_identity_hash_secret_key_distinct_from_jwt_secret_999999";
}

if (!process.env.IDENTITY_PROVIDER) {
  process.env.IDENTITY_PROVIDER = "mock";
}

if (!process.env.SMS_PROVIDER) {
  process.env.SMS_PROVIDER = "mock";
}

// Tests create many accounts from one IP; raise per-IP limiters for tests only.
process.env.AUTH_REGISTER_RATE_LIMIT_MAX = "1000";
process.env.AUTH_LOGIN_RATE_LIMIT_MAX = "1000";
process.env.RATE_LIMIT_MAX_REQUESTS = "100000";
