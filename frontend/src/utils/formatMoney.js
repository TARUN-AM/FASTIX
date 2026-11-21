const indianRupeeFormatter = new Intl.NumberFormat("en-IN");
const RUPEE_INPUT_REGEX = /^\d{1,9}(\.\d{1,2})?$/;

/**
 * Formats an integer amount of paise into an Indian Rupee string
 * (e.g. 500000 -> "Rs 5,000", 500050 -> "Rs 5,000.50", 15000000 -> "Rs 1,50,000").
 * Uses integer division and remainder only; never floating-point math.
 */
export function formatRupees(paise) {
  if (typeof paise !== "number" || !Number.isSafeInteger(paise) || paise < 0) {
    return "Invalid amount";
  }

  const wholeRupees = Math.floor(paise / 100);
  const remainderPaise = paise % 100;
  const formattedWhole = indianRupeeFormatter.format(wholeRupees);

  if (remainderPaise === 0) {
    return `Rs ${formattedWhole}`;
  }

  return `Rs ${formattedWhole}.${String(remainderPaise).padStart(2, "0")}`;
}

/**
 * Parses a decimal rupee text string (e.g. "5000", "5000.5", "5000.50", "0.01")
 * into an integer number of paise using string splitting and integer arithmetic only.
 * Never uses parseFloat or decimal multiplication. Returns null for any invalid input.
 */
export function parseRupeesToPaise(text) {
  if (typeof text !== "string") {
    return null;
  }

  const trimmed = text.trim();
  if (!RUPEE_INPUT_REGEX.test(trimmed)) {
    return null;
  }

  const [rupeesPart, rawPaisePart = ""] = trimmed.split(".");
  const paddedPaisePart = rawPaisePart.padEnd(2, "0");

  const rupeesInt = Number.parseInt(rupeesPart, 10);
  const paiseInt = Number.parseInt(paddedPaisePart, 10);

  if (!Number.isSafeInteger(rupeesInt) || !Number.isSafeInteger(paiseInt)) {
    return null;
  }

  const totalPaise = rupeesInt * 100 + paiseInt;
  if (!Number.isSafeInteger(totalPaise) || totalPaise < 0) {
    return null;
  }

  return totalPaise;
}

/**
 * Converts an integer number of paise into a plain decimal rupee input string
 * without commas (e.g. 500000 -> "5000", 500050 -> "5000.50") for form editing.
 */
export function formatPaiseToRupeeInput(paise) {
  if (typeof paise !== "number" || !Number.isSafeInteger(paise) || paise < 0) {
    return "";
  }
  const wholeRupees = Math.floor(paise / 100);
  const remainderPaise = paise % 100;
  if (remainderPaise === 0) {
    return String(wholeRupees);
  }
  return `${wholeRupees}.${String(remainderPaise).padStart(2, "0")}`;
}

/**
 * Computes the 110% maximum resale price in integer paise for display only.
 * IMPORTANT: The backend API and smart contract are the real authority for resale caps.
 */
export function calculateMaxResalePrice(originalPricePaise) {
  if (
    typeof originalPricePaise !== "number" ||
    !Number.isSafeInteger(originalPricePaise) ||
    originalPricePaise < 0
  ) {
    return null;
  }
  return Math.floor((originalPricePaise * 110) / 100);
}

// Backwards-compatible alias used in earlier components
export const calculateMaxResalePricePaise = calculateMaxResalePrice;
