const express = require("express");
const healthRoutes = require("./health.routes");
const verificationRoutes = require("./verification.routes");

const router = express.Router();

router.use("/health", healthRoutes);
router.use("/verification", verificationRoutes);

// Remaining feature routers (auth, wallet, events, queue, holds, bookings,
// captcha, tickets, resales, gate, trust-guardian, admin, organizer)
// are mounted in their respective build prompts.

module.exports = router;
