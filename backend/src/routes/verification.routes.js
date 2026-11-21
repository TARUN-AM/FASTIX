const express = require("express");
const { USER_ROLES } = require("../config/constants");
const { authenticate } = require("../middleware/auth.middleware");
const { requireRole } = require("../middleware/role.middleware");
const {
  createIdentitySubmitLimiter,
  createOtpSendLimiter,
  createOtpVerifyLimiter,
} = require("../middleware/rateLimit.middleware");
const verificationController = require("../controllers/verification.controller");

function createVerificationRouter(options = {}) {
  const router = express.Router();
  const otpSendLimiter = options.otpSendLimiter || createOtpSendLimiter();
  const otpVerifyLimiter = options.otpVerifyLimiter || createOtpVerifyLimiter();
  const identitySubmitLimiter =
    options.identitySubmitLimiter || createIdentitySubmitLimiter();

  router.get("/status", authenticate, verificationController.getStatus);

  router.post(
    "/otp/request",
    authenticate,
    requireRole(USER_ROLES.CUSTOMER),
    otpSendLimiter,
    verificationController.requestPhoneOtp
  );

  router.post(
    "/otp/verify",
    authenticate,
    requireRole(USER_ROLES.CUSTOMER),
    otpVerifyLimiter,
    verificationController.verifyPhoneOtp
  );

  router.post(
    "/identity/submit",
    authenticate,
    requireRole(USER_ROLES.CUSTOMER),
    identitySubmitLimiter,
    verificationController.submitIdentity
  );

  return router;
}

const defaultRouter = createVerificationRouter();
defaultRouter.createVerificationRouter = createVerificationRouter;

module.exports = defaultRouter;
