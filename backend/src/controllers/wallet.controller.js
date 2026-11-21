const { ERROR_CODES } = require("../config/constants");
const { sendSuccess, sendError } = require("../utils/apiResponse");
const {
  isPlainObject,
  rejectUnknownFields,
  validateWalletAddress,
  validateSignature,
} = require("../utils/validators");
const walletService = require("../services/wallet.service");

const ALLOWED_CHALLENGE_FIELDS = ["walletAddress"];
const ALLOWED_LINK_FIELDS = ["walletAddress", "signature"];

function extractRequestMeta(req) {
  return {
    ipAddress: req.ip || req.socket?.remoteAddress || "",
    userAgent: req.get("user-agent") || "",
  };
}

/**
 * POST /api/v1/wallet/nonce
 * Issues a single-use, time-limited signing challenge for the submitted walletAddress.
 */
async function requestWalletChallenge(req, res, next) {
  try {
    const body = req.body;

    if (!isPlainObject(body)) {
      return sendError(
        res,
        400,
        ERROR_CODES.VALIDATION_ERROR,
        "Request body must be a JSON object."
      );
    }

    const unknownFields = rejectUnknownFields(body, ALLOWED_CHALLENGE_FIELDS);
    if (unknownFields.length > 0) {
      const details = {};
      for (const field of unknownFields) {
        details[field] = "Field is not allowed.";
      }
      return sendError(
        res,
        400,
        ERROR_CODES.VALIDATION_ERROR,
        "Request contains fields that are not allowed.",
        details
      );
    }

    const addressResult = validateWalletAddress(body.walletAddress);
    if (!addressResult.valid) {
      return sendError(
        res,
        400,
        ERROR_CODES.VALIDATION_ERROR,
        addressResult.message,
        { walletAddress: addressResult.message }
      );
    }

    const result = await walletService.createChallenge(
      req.user._id,
      body.walletAddress,
      extractRequestMeta(req)
    );
    return sendSuccess(res, result, 200);
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/v1/wallet/link
 * Verifies the MetaMask personal_sign signature against the server-rebuilt challenge
 * and links the wallet to the authenticated verified CUSTOMER account.
 * Rejects any client-supplied message, nonce, chainId, or unexpected fields.
 */
async function verifyWalletLink(req, res, next) {
  try {
    const body = req.body;

    if (!isPlainObject(body)) {
      return sendError(
        res,
        400,
        ERROR_CODES.VALIDATION_ERROR,
        "Request body must be a JSON object."
      );
    }

    const unknownFields = rejectUnknownFields(body, ALLOWED_LINK_FIELDS);
    if (unknownFields.length > 0) {
      const details = {};
      for (const field of unknownFields) {
        details[field] = "Field is not allowed.";
      }
      return sendError(
        res,
        400,
        ERROR_CODES.VALIDATION_ERROR,
        "Request contains fields that are not allowed.",
        details
      );
    }

    const fieldErrors = {};
    const addressResult = validateWalletAddress(body.walletAddress);
    if (!addressResult.valid) {
      fieldErrors.walletAddress = addressResult.message;
    }

    const signatureResult = validateSignature(body.signature);
    if (!signatureResult.valid) {
      fieldErrors.signature = signatureResult.message;
    }

    if (Object.keys(fieldErrors).length > 0) {
      return sendError(
        res,
        400,
        ERROR_CODES.VALIDATION_ERROR,
        "Please provide a valid wallet address and signature.",
        fieldErrors
      );
    }

    const result = await walletService.verifyChallenge(
      req.user._id,
      {
        walletAddress: body.walletAddress,
        signature: signatureResult.value,
      },
      extractRequestMeta(req)
    );
    return sendSuccess(res, result, 200);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  requestWalletChallenge,
  verifyWalletLink,
};
