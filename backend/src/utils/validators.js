const { ethers } = require("ethers");
const { ALLOWED_IDENTITY_DOC_TYPES } = require("../config/constants");
const {
  WALLET_ADDRESS_REGEX,
  normalizeDocumentNumber,
  normalizeEmail,
  normalizePhone,
  normalizeWalletAddress,
} = require("./normalize");

const DEMO_DOC_NUMBER_REGEX = /^DEMO-[A-Z0-9]{6,12}$/;
const AADHAAR_LIKE_REGEX = /^\d{12}$/;
const PAN_LIKE_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/i;
const NINE_PLUS_DIGITS_REGEX = /^\d{9,}$/;
const WALLET_SIGNATURE_REGEX = /^0x[0-9a-fA-F]{130}$/;

const NAME_ALLOWED_REGEX = /^[\p{L} .'-]+$/u;
const EMAIL_FORMAT_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const INDIAN_MOBILE_10_REGEX = /^[6-9]\d{9}$/;
const INTERNATIONAL_E164_REGEX = /^\+[1-9]\d{9,14}$/;
const HAS_LETTER_REGEX = /[A-Za-z]/;
const HAS_NUMBER_REGEX = /[0-9]/;

const COMMON_PASSWORDS = new Set([
  "password12",
  "password123",
  "password1234",
  "passw0rd12",
  "1234567890",
  "123456789a",
  "qwerty1234",
  "qwertyuiop1",
  "admin12345",
  "welcome123",
  "letmein123",
  "iloveyou12",
  "abc1234567",
  "fairticket1",
  "fairticket123",
  "ticket1234",
  "coldplay12",
  "concert123",
  "football12",
  "baseball12",
  "monkey1234",
  "dragon1234",
  "master1234",
  "shadow1234",
  "sunshine12",
  "princess12",
]);

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
  if (trimmed.length > 80) {
    return {
      valid: false,
      message: `${fieldLabel} must be at most 80 characters long.`,
    };
  }
  if (!NAME_ALLOWED_REGEX.test(trimmed)) {
    return {
      valid: false,
      message: `${fieldLabel} may contain only letters, spaces, dots, apostrophes, and hyphens.`,
    };
  }
  return { valid: true, value: trimmed };
}

function validateEmail(value) {
  if (!isPlainString(value)) {
    return { valid: false, message: "Email must be a text string." };
  }
  const normalized = normalizeEmail(value);
  if (!normalized) {
    return { valid: false, message: "Email is required." };
  }
  if (normalized.length > 254) {
    return {
      valid: false,
      message: "Email must be at most 254 characters long.",
    };
  }
  if (normalized.includes("..") || !EMAIL_FORMAT_REGEX.test(normalized)) {
    return { valid: false, message: "Please enter a valid email address." };
  }
  return { valid: true, value: normalized };
}

function validatePhone(value) {
  if (!isPlainString(value)) {
    return { valid: false, message: "Phone number must be a text string." };
  }
  const normalized = normalizePhone(value);
  if (!normalized) {
    return { valid: false, message: "Phone number is required." };
  }

  if (INDIAN_MOBILE_10_REGEX.test(normalized)) {
    return { valid: true, value: `+91${normalized}` };
  }

  if (INTERNATIONAL_E164_REGEX.test(normalized)) {
    return { valid: true, value: normalized };
  }

  return {
    valid: false,
    message:
      "Phone number must be a 10-digit Indian mobile number or international number starting with + (e.g., +919876543210).",
  };
}

function validatePassword(value, options = {}) {
  if (!isPlainString(value)) {
    return { valid: false, message: "Password must be a text string." };
  }
  if (value.length < 10) {
    return {
      valid: false,
      message: "Password must be at least 10 characters long.",
    };
  }
  if (Buffer.byteLength(value, "utf8") > 72) {
    return {
      valid: false,
      message: "Password must be at most 72 bytes long.",
    };
  }
  if (!HAS_LETTER_REGEX.test(value) || !HAS_NUMBER_REGEX.test(value)) {
    return {
      valid: false,
      message: "Password must contain at least one letter and one number.",
    };
  }

  const lower = value.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) {
    return {
      valid: false,
      message: "This password is too common. Please choose a stronger password.",
    };
  }

  if (isPlainString(options.email)) {
    const normalizedEmail = normalizeEmail(options.email);
    const localPart = normalizedEmail.split("@")[0];
    if (
      (normalizedEmail && lower === normalizedEmail) ||
      (localPart && lower === localPart)
    ) {
      return {
        valid: false,
        message: "Password must not match your email address.",
      };
    }
  }

  return { valid: true, value };
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
 * PAN-like, or any string of 9+ digits after NFKC normalization and removing spaces,
 * zero-width characters, and hyphens) before format validation so users get an
 * explicit warning and the value is never stored.
 */
function looksLikeRealId(value) {
  if (!isPlainString(value)) {
    return false;
  }
  const compact = value
    .normalize("NFKC")
    .replace(
      /[\s\u00A0\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F\u2060\u3000\uFEFF-]+/g,
      ""
    );
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

function validateOtp(value, expectedLength = 6) {
  if (!isPlainString(value)) {
    return {
      valid: false,
      message: `Verification code must be a ${expectedLength}-digit string.`,
    };
  }
  const exactDigitsRegex = new RegExp(`^\\d{${expectedLength}}$`);
  if (!exactDigitsRegex.test(value)) {
    return {
      valid: false,
      message: `Verification code must be exactly ${expectedLength} digits.`,
    };
  }
  return { valid: true, value };
}

/**
 * Validates an Ethereum wallet address.
 * - Must be a plain string matching 0x + 40 hex characters.
 * - Accepts all-lowercase, all-uppercase, or valid EIP-55 mixed-case checksum.
 * - Rejects mixed-case addresses with an invalid EIP-55 checksum.
 * - Returns both the lowercase normalized storage value and the EIP-55 checksum address.
 */
function validateWalletAddress(value) {
  if (!isPlainString(value)) {
    return { valid: false, message: "Wallet address must be a text string." };
  }
  const trimmed = value.trim();
  if (!WALLET_ADDRESS_REGEX.test(trimmed)) {
    return {
      valid: false,
      message:
        "Wallet address must be a valid Ethereum address (0x followed by 40 hex characters).",
    };
  }

  const hexBody = trimmed.slice(2);
  const isAllLower = hexBody === hexBody.toLowerCase();
  const isAllUpper = hexBody === hexBody.toUpperCase();

  let checksumAddress;
  try {
    checksumAddress =
      isAllLower || isAllUpper
        ? ethers.getAddress(trimmed.toLowerCase())
        : ethers.getAddress(trimmed);
  } catch (_err) {
    return {
      valid: false,
      message: "Wallet address has an invalid EIP-55 checksum.",
    };
  }

  if (!ethers.isAddress(checksumAddress)) {
    return {
      valid: false,
      message: "Wallet address is not a valid Ethereum address.",
    };
  }

  return {
    valid: true,
    value: normalizeWalletAddress(trimmed),
    checksumAddress,
  };
}

/**
 * Validates a 65-byte ECDSA personal_sign hex signature (0x + 130 hex chars).
 */
function validateSignature(value) {
  if (!isPlainString(value)) {
    return { valid: false, message: "Signature must be a text string." };
  }
  if (!WALLET_SIGNATURE_REGEX.test(value)) {
    return {
      valid: false,
      message:
        "Signature must be a valid 65-byte hexadecimal signature starting with 0x.",
    };
  }
  return { valid: true, value };
}

module.exports = {
  COMMON_PASSWORDS,
  isPlainObject,
  isPlainString,
  rejectUnknownFields,
  validateName,
  validateEmail,
  validatePhone,
  validatePassword,
  validateOtp,
  validateDocumentType,
  looksLikeRealId,
  validateDemoDocumentNumber,
  validateConsent,
  validateWalletAddress,
  validateSignature,
};
