const express = require("express");
const mongoose = require("mongoose");
const { sendSuccess } = require("../utils/apiResponse");

const router = express.Router();

router.get("/", (req, res) => {
  const database =
    mongoose.connection.readyState === 1 ? "connected" : "disconnected";

  return sendSuccess(res, {
    status: "ok",
    service: "fairticket-backend",
    time: new Date().toISOString(),
    database,
  });
});

module.exports = router;
