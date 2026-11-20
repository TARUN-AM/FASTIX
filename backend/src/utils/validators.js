const { ALLOWED_IDENTITY_DOC_TYPES } = require("../config/constants");
const { normalizeDocumentNumber } = require("./normalize");

const DEMO_DOC_NUMBER_REGEX = /^DEMO-[A-Z0-9]{6,12}$/;
const AADHAAR_LIKE_REGEX = /^\d{12}$/;
const PAN_LIKE_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/i;
const NINE_PLUS_DIGITS_REGEX = /^\d{9,}$/;

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function isPlainString(value) {
  return typeof value === "string";
}

/**
 * Checks a request body object for any keys outside `allowedFields`.
 * Returns an array of unknown field names.
 */
function rejectUnknownFields(body, allowedFields) {
  if (!isPlainObject(body)) {
    return [];
  }
  const allowedSet = new Set(allowedFields);
  return Object.keys(body).filter((key) => !allowedSet.has(key));
}

function validateName(value, fieldLabel = "Full name") {
  if (!isPlainString(value)) {
    return { valid: false, message: `${fieldLabel} must be a text string.` };
  }
  const trimmed = value.trim();
  if (trimmed.length < 2) {
    return {
      valid: false,
      message: `${fieldLabel} must be at least 2 characters long.`,
    };
  }
  if (trimmed.length > 100) {
    return {
      valid: false,
      message: `${fieldLabel} must be at most 100 characters long.`,
    };
  }
  return { valid: true, value: trimmed };
}

function validateDocumentType(value) {
  if (!isPlainString(value)) {
    return { valid: false, message: "Document type must be a text string." };
  }
  const trimmed = value.trim();
  if (!ALLOWED_IDENTITY_DOC_TYPES.includes(trimmed)) {
    return {
      valid: false,
      message: `Unsupported document type. Allowed types: ${ALLOWED_IDENTITY_DOC_TYPES.join(
        ", "
      )}.`,
    };
  }
  return { valid: true, value: trimmed };
}

/**
 * Best-effort safety check to catch real Indian ID patterns (12-digit Aadhaar-like,
 * PAN-like, or any string of 9+ digits after removing spaces and hyphens) before
 * format validation so users get an explicit warning and the value is never stored.
 */
function looksLikeRealId(value) {
  if (!isPlainString(value)) {
    return false;
  }
  const compact = value.replace(/[\s-]+/g, "");
  if (!compact) {
    return false;
  }
  return (
    AADHAAR_LIKE_REGEX.test(compact) ||
    PAN_LIKE_REGEX.test(compact) ||
    NINE_PLUS_DIGITS_REGEX.test(compact)
  );
}

function validateDemoDocumentNumber(value) {
  if (!isPlainString(value)) {
    return { valid: false, message: "Demo ID number must be a text string." };
  }
  const normalized = normalizeDocumentNumber(value);
  if (!DEMO_DOC_NUMBER_REGEX.test(normalized)) {
    return {
      valid: false,
      message:
        "Demo ID number must follow the format DEMO- followed by 6 to 12 letters or digits (for example, DEMO-ABC12345).",
    };
  }
  return { valid: true, value: normalized };
}

function validateConsent(value) {
  if (value !== true) {
    return {
      valid: false,
      message: "You must explicitly agree to the simulated identity check.",
    };
  }
  return { valid: true, value: true };
}

module.exports = {
  isPlainObject,
  isPlainString,
  rejectUnknownFields,
  validateName,
  validateDocumentType,
  looksLikeRealId,
  validateDemoDocumentNumber,
  validateConsent,
};
