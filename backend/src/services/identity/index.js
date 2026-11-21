const config = require("../../config/env");
const mockIdentityProvider = require("./mockIdentityProvider");

/*
 * Provider selector for identity verification.
 * Currently only "mock" is enabled for the demo. In production, an authorized
 * KYC provider adapter approved under applicable Indian regulations can be
 * registered here behind IDENTITY_PROVIDER without modifying callers.
 */

function getIdentityProvider() {
  if (config.identityProvider === "mock") {
    return mockIdentityProvider;
  }
  throw new Error(
    `Unsupported IDENTITY_PROVIDER "${config.identityProvider}". Only "mock" is available.`
  );
}

module.exports = {
  getIdentityProvider,
};
