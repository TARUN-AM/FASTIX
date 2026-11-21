/**
 * In-memory mock SMS provider for automated Jest tests only.
 * Never permitted in NODE_ENV=production.
 *
 * Production note: Swap this layer in src/services/sms/index.js with a
 * licensed SMS gateway (complying with India TRAI DLT commercial SMS
 * registration rules) without modifying otp.service.js or route handlers.
 */
const sentMessages = [];

async function sendOtp({ phone, otp, expiresInSeconds }) {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "mockSmsProvider cannot be used when NODE_ENV=production."
    );
  }

  sentMessages.push({
    phone,
    otp,
    expiresInSeconds,
    sentAt: new Date().toISOString(),
  });

  return { delivered: true, simulated: true };
}

function getSentMessages() {
  return sentMessages.slice();
}

function clearSentMessages() {
  sentMessages.length = 0;
}

module.exports = {
  providerName: "SIMULATED_MOCK_SMS",
  sendOtp,
  getSentMessages,
  clearSentMessages,
};
