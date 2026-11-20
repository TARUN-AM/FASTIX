function sendSuccess(res, data, status = 200) {
  return res.status(status).json({
    success: true,
    data,
    error: null,
  });
}

function sendError(res, status, code, message, details) {
  const errorPayload = {
    code,
    message,
  };
  if (details !== undefined) {
    errorPayload.details = details;
  }

  return res.status(status).json({
    success: false,
    data: null,
    error: errorPayload,
  });
}

module.exports = {
  sendSuccess,
  sendError,
};
