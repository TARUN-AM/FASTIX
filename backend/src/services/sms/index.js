const config = require("../../config/env");
const consoleSmsProvider = require("./consoleSmsProvider");
const mockSmsProvider = require("./mockSmsProvider");

/**
 * SMS provider registry.
 *
 * Production note: Replacing the simulated providers with a licensed SMS
 * gateway (registered under India's TRAI DLT commercial SMS framework) only
 * requires adding a new provider module and wiring it here — otp.service.js,
 * controllers, and routes remain unchanged.
 */
function getSmsProvider() {
  const providerName = (
    process.env.SMS_PROVIDER ||
    config.otp.smsProvider ||
    "console"
  )
    .trim()
    .toLowerCase();

  if (providerName === "mock") {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        'SMS_PROVIDER="mock" is not allowed when NODE_ENV=production.'
      );
    }
    return mockSmsProvider;
  }

  if (providerName === "console") {
    return consoleSmsProvider;
  }

  throw new Error(`Unsupported SMS_PROVIDER "${providerName}".`);
}

module.exports = {
  getSmsProvider,
  consoleSmsProvider,
  mockSmsProvider,
};
