const express = require("express");
const authController = require("../controllers/auth.controller");
const { authenticate } = require("../middleware/auth.middleware");
const {
  createLoginLimiter,
  createRegisterLimiter,
} = require("../middleware/rateLimit.middleware");

function createAuthRouter(options = {}) {
  const router = express.Router();
  const registerLimiter = options.registerLimiter || createRegisterLimiter();
  const loginLimiter = options.loginLimiter || createLoginLimiter();

  router.post("/register", registerLimiter, authController.register);
  router.post("/login", loginLimiter, authController.login);
  router.get("/me", authenticate, authController.me);
  router.post("/logout", authenticate, authController.logout);

  return router;
}

const defaultRouter = createAuthRouter();
defaultRouter.createAuthRouter = createAuthRouter;

module.exports = defaultRouter;
