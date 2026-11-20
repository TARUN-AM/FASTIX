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
 * Normalizes a demo document number by trimming, uppercasing, and removing all whitespace.
 */
function normalizeDocumentNumber(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toUpperCase().replace(/\s+/g, "");
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

module.exports = {
  WALLET_ADDRESS_REGEX,
  BYTES32_HEX_REGEX,
  IDENTITY_HASH_REGEX,
  normalizeEmail,
  normalizePhone,
  normalizeName,
  normalizeDocumentNumber,
  isValidWalletAddress,
  normalizeWalletAddress,
  walletAddressSetter,
  walletAddressValidator,
};
