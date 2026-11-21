const express = require("express");
const healthRoutes = require("./health.routes");
const authRoutes = require("./auth.routes");
const verificationRoutes = require("./verification.routes");
const walletRoutes = require("./wallet.routes");
const eventRoutes = require("./event.routes");

const router = express.Router();

router.use("/health", healthRoutes);
router.use("/auth", authRoutes);
router.use("/verification", verificationRoutes);
router.use("/wallet", walletRoutes);
router.use("/events", eventRoutes);

// Remaining feature routers (queue, holds, bookings,
// captcha, tickets, resales, gate, trust-guardian, admin, organizer)
// are mounted in their respective build prompts.

module.exports = router;
