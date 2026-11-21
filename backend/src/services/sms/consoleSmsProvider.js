const config = require("../../config/env");
const { maskPhone } = require("../../utils/normalize");

/**
 * Simulated console SMS provider for local development.
 *
 * Production note: Replace this adapter with a licensed SMS gateway
 * (such as MSG91, Twilio Verify, or AWS SNS) registered under India's
 * TRAI DLT commercial messaging rules (approved entity ID, sender header,
 * and OTP template ID). No callers in otp.service.js or controllers need
 * to change when swapping providers here.
 */
async function sendOtp({ phone, otp, expiresInSeconds }) {
  const nodeEnv = (process.env.NODE_ENV || config.nodeEnv || "development").trim();

  if (nodeEnv === "production") {
    console.warn(
      "[FairTicket SMS Warning] No production SMS gateway is configured. OTP was NOT printed to console."
    );
    return { delivered: true, simulated: true };
  }

  if (nodeEnv === "development") {
    const minutes = Math.max(1, Math.round((expiresInSeconds || 300) / 60));
    const masked = maskPhone(phone);
    console.log(
      `[SIMULATED SMS] To ${masked}: Your FairTicket code is ${otp}. Valid for ${minutes} minutes.`
    );
  }

  return { delivered: true, simulated: true };
}

module.exports = {
  providerName: "SIMULATED_CONSOLE_SMS",
  sendOtp,
};
