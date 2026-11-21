const express = require("express");
const { USER_ROLES } = require("../config/constants");
const { authenticate } = require("../middleware/auth.middleware");
const { requireRole } = require("../middleware/role.middleware");
const { requireVerifiedUser } = require("../middleware/verifiedUser.middleware");
const {
  createWalletChallengeLimiter,
  createWalletVerifyLimiter,
} = require("../middleware/rateLimit.middleware");
const walletController = require("../controllers/wallet.controller");

function createWalletRouter(options = {}) {
  const router = express.Router();
  const walletChallengeLimiter =
    options.walletChallengeLimiter || createWalletChallengeLimiter();
  const walletVerifyLimiter =
    options.walletVerifyLimiter || createWalletVerifyLimiter();

  const requireVerifiedIdentity = requireVerifiedUser({ requireWallet: false });

  router.post(
    "/nonce",
    authenticate,
    requireRole(USER_ROLES.CUSTOMER),
    requireVerifiedIdentity,
    walletChallengeLimiter,
    walletController.requestWalletChallenge
  );

  router.post(
    "/link",
    authenticate,
    requireRole(USER_ROLES.CUSTOMER),
    requireVerifiedIdentity,
    walletVerifyLimiter,
    walletController.verifyWalletLink
  );

  return router;
}

const defaultRouter = createWalletRouter();
defaultRouter.createWalletRouter = createWalletRouter;

module.exports = defaultRouter;
