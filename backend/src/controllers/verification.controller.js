const {
  ERROR_CODES,
  SECURITY_EVENT_TYPES,
  SECURITY_SEVERITIES,
} = require("../config/constants");
const { sendSuccess, sendError } = require("../utils/apiResponse");
const {
  isPlainObject,
  isPlainString,
  rejectUnknownFields,
  validateDocumentType,
  looksLikeRealId,
  validateDemoDocumentNumber,
  validateName,
  validateConsent,
} = require("../utils/validators");
const identityService = require("../services/identity.service");
const { logSecurityEvent } = require("../services/securityLog.service");

const ALLOWED_IDENTITY_SUBMIT_FIELDS = [
  "documentType",
  "documentNumber",
  "fullNameOnDocument",
  "consent",
];

function extractRequestMeta(req) {
  return {
    ipAddress: req.ip || req.socket?.remoteAddress || "",
    userAgent: req.get("user-agent") || "",
  };
}

async function getStatus(req, res, next) {
  try {
    const status = await identityService.getVerificationStatus(req.user._id);
    return sendSuccess(res, status, 200);
  } catch (err) {
    return next(err);
  }
}

async function submitIdentity(req, res, next) {
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

    // 1. Reject any unknown field immediately (blocks identityHash, identityStatus, role, etc.)
    const unknownFields = rejectUnknownFields(
      body,
      ALLOWED_IDENTITY_SUBMIT_FIELDS
    );
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

    // 2. Check plain types before running safety/format checks
    const typeErrors = {};
    if (body.documentType !== undefined && !isPlainString(body.documentType)) {
      typeErrors.documentType = "Document type must be a text string.";
    }
    if (
      body.documentNumber !== undefined &&
      !isPlainString(body.documentNumber)
    ) {
      typeErrors.documentNumber = "Demo ID number must be a text string.";
    }
    if (
      body.fullNameOnDocument !== undefined &&
      !isPlainString(body.fullNameOnDocument)
    ) {
      typeErrors.fullNameOnDocument =
        "Name on document must be a text string.";
    }
    if (Object.keys(typeErrors).length > 0) {
      return sendError(
        res,
        400,
        ERROR_CODES.VALIDATION_ERROR,
        "One or more fields have an invalid type.",
        typeErrors
      );
    }

    // 3. Best-effort real-ID safety check BEFORE format validation.
    // Never store, echo, or log the submitted value; does not consume attempt counter.
    if (isPlainString(body.documentNumber) && looksLikeRealId(body.documentNumber)) {
      const requestMeta = extractRequestMeta(req);
      await logSecurityEvent({
        eventType: SECURITY_EVENT_TYPES.REAL_ID_BLOCKED,
        severity: SECURITY_SEVERITIES.MEDIUM,
        userId: req.user._id,
        ipAddress: requestMeta.ipAddress,
        userAgent: requestMeta.userAgent,
        details: {
          reason: "REAL_ID_PATTERN_DETECTED",
        },
      });

      return sendError(
        res,
        400,
        ERROR_CODES.REAL_ID_NOT_ALLOWED,
        "Please do not enter real ID numbers. Use a demo ID like DEMO-ABC12345."
      );
    }

    // 4. Validate all fields and return ALL field errors together in error.details
    const fieldErrors = {};

    const docTypeResult = validateDocumentType(body.documentType);
    if (!docTypeResult.valid) {
      fieldErrors.documentType = docTypeResult.message;
    }

    const docNumberResult = validateDemoDocumentNumber(body.documentNumber);
    if (!docNumberResult.valid) {
      fieldErrors.documentNumber = docNumberResult.message;
    }

    const nameResult = validateName(
      body.fullNameOnDocument,
      "Name on document"
    );
    if (!nameResult.valid) {
      fieldErrors.fullNameOnDocument = nameResult.message;
    }

    const consentResult = validateConsent(body.consent);
    if (!consentResult.valid) {
      fieldErrors.consent = consentResult.message;
    }

    if (Object.keys(fieldErrors).length > 0) {
      return sendError(
        res,
        400,
        ERROR_CODES.VALIDATION_ERROR,
        "Please correct the highlighted identity verification fields.",
        fieldErrors
      );
    }

    const result = await identityService.submitIdentity(
      req.user._id,
      {
        documentType: docTypeResult.value,
        documentNumber: docNumberResult.value,
        fullNameOnDocument: nameResult.value,
        consent: consentResult.value,
      },
      extractRequestMeta(req)
    );

    return sendSuccess(res, result, 200);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  getStatus,
  submitIdentity,
};
