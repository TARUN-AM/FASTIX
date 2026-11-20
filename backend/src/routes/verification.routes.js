const express = require("express");
const { USER_ROLES } = require("../config/constants");
const { authenticate } = require("../middleware/auth.middleware");
const { requireRole } = require("../middleware/role.middleware");
const {
  createIdentitySubmitLimiter,
} = require("../middleware/rateLimit.middleware");
const verificationController = require("../controllers/verification.controller");

function createVerificationRouter(options = {}) {
  const router = express.Router();
  const identitySubmitLimiter =
    options.identitySubmitLimiter || createIdentitySubmitLimiter();

  router.get("/status", authenticate, verificationController.getStatus);

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
