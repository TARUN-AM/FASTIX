const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");
const config = require("./config/env");
const apiV1Routes = require("./routes");
const { globalRateLimiter } = require("./middleware/rateLimit.middleware");
const {
  notFoundHandler,
  errorHandler,
} = require("./middleware/errorHandler.middleware");

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: config.frontendOrigin,
    credentials: true,
    exposedHeaders: ["Date"],
  })
);
app.use(express.json({ limit: "100kb" }));

if (config.nodeEnv !== "test") {
  app.use(morgan("dev"));
}

app.use(globalRateLimiter);

app.use("/api/v1", apiV1Routes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
