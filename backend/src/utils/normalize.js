const WALLET_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const BYTES32_HEX_REGEX = /^0x[a-fA-F0-9]{64}$/;
const IDENTITY_HASH_REGEX = /^(0x)?[a-fA-F0-9]{64}$/;

function normalizeEmail(value) {
  if (typeof value !== "string") {
    return value;
  }
  return value.trim().toLowerCase();
}

function normalizePhone(value) {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  const hasLeadingPlus = trimmed.startsWith("+");
  const digitsOnly = trimmed.replace(/\D/g, "");
  return hasLeadingPlus ? `+${digitsOnly}` : digitsOnly;
}

/**
 * Normalizes a person's name for accent-, case-, and whitespace-insensitive comparison:
 * trims edges, collapses internal whitespace to single spaces, strips diacritics via NFKD,
 * and converts to lowercase.
 */
function normalizeName(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * Normalizes a demo document number by applying NFKC first (converting full-width
 * characters like "ＤＥＭＯ-ＡＢＣ１２３４５" into ASCII), trimming, removing all
 * Unicode whitespace and zero-width/invisible characters (U+200B, U+200C, U+200D,
 * U+FEFF, NBSP, etc.), and uppercasing. Non-ASCII look-alikes (such as Cyrillic "А")
 * remain non-ASCII so the strict ASCII format validator rejects them.
 */
function normalizeDocumentNumber(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value
    .normalize("NFKC")
    .trim()
    .replace(/[\s\u00A0\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F\u2060\u3000\uFEFF]+/g, "")
    .toUpperCase();
}

function isValidWalletAddress(value) {
  return typeof value === "string" && WALLET_ADDRESS_REGEX.test(value.trim());
}

function normalizeWalletAddress(value) {
  if (typeof value !== "string") {
    throw new TypeError(
      "Wallet address must be a string in 0x followed by 40 hex characters format."
    );
  }
  const trimmed = value.trim();
  if (!WALLET_ADDRESS_REGEX.test(trimmed)) {
    throw new Error(
      `Invalid Ethereum wallet address "${value}". Expected 0x followed by 40 hexadecimal characters.`
    );
  }
  return trimmed.toLowerCase();
}

function walletAddressSetter(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    return value;
  }
  return value.trim().toLowerCase();
}

const walletAddressValidator = Object.freeze({
  validator: (value) =>
    value === undefined || value === null || isValidWalletAddress(value),
  message: "must be a valid Ethereum wallet address (0x + 40 hex characters)",
});

/**
 * Masks a phone number so only the last 4 digits remain visible
 * (e.g., "+919876543210" -> "+91******3210", "9876543210" -> "******3210").
 */
function maskPhone(phone) {
  if (typeof phone !== "string") {
    return "";
  }
  const trimmed = phone.trim();
  if (!trimmed) {
    return "";
  }
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length <= 4) {
    return `${hasPlus ? "+" : ""}${"*".repeat(digits.length)}`;
  }

  const lastFour = digits.slice(-4);
  if (hasPlus && digits.length > 6) {
    // Preserve short country code (e.g. +91) while masking all subscriber digits except last 4
    const countryPrefixLen = digits.length >= 12 ? 2 : 1;
    const countryPrefix = digits.slice(0, countryPrefixLen);
    const maskedMiddle = "*".repeat(digits.length - countryPrefixLen - 4);
    return `+${countryPrefix}${maskedMiddle}${lastFour}`;
  }

  return `${hasPlus ? "+" : ""}${"*".repeat(digits.length - 4)}${lastFour}`;
}

module.exports = {
  WALLET_ADDRESS_REGEX,
  BYTES32_HEX_REGEX,
  IDENTITY_HASH_REGEX,
  normalizeEmail,
  normalizePhone,
  maskPhone,
  normalizeName,
  normalizeDocumentNumber,
  isValidWalletAddress,
  normalizeWalletAddress,
  walletAddressSetter,
  walletAddressValidator,
};
