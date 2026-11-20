const config = require("../config/env");
const { ERROR_CODES } = require("../config/constants");
const { sendError } = require("../utils/apiResponse");

function notFoundHandler(req, res) {
  return sendError(
    res,
    404,
    ERROR_CODES.NOT_FOUND,
    `Route ${req.method} ${req.originalUrl} was not found.`
  );
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Never echo malformed JSON body contents or raw user inputs
  if (
    err &&
    (err.type === "entity.parse.failed" ||
      (err instanceof SyntaxError && err.status === 400 && "body" in err))
  ) {
    return sendError(
      res,
      400,
      ERROR_CODES.VALIDATION_ERROR,
      "Malformed JSON request body."
    );
  }

  if (err && err.type === "entity.too.large") {
    return sendError(
      res,
      413,
      ERROR_CODES.VALIDATION_ERROR,
      "Request payload exceeds the 100kb size limit."
    );
  }

  if (err && err.isOperational && err.statusCode && err.code) {
    return sendError(res, err.statusCode, err.code, err.message, err.details);
  }

  if (config.nodeEnv !== "test") {
    // Log only non-sensitive metadata; never log req.body
    console.error("[FairTicket Backend Error]", {
      name: err?.name || "Error",
      code: err?.code,
    });
  }

  return sendError(
    res,
    500,
    ERROR_CODES.INTERNAL_ERROR,
    "An unexpected server error occurred."
  );
}

module.exports = {
  notFoundHandler,
  errorHandler,
};
