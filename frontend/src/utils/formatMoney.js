const indianRupeeFormatter = new Intl.NumberFormat("en-IN");

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

export function calculateMaxResalePricePaise(originalPricePaise) {
  if (
    typeof originalPricePaise !== "number" ||
    !Number.isSafeInteger(originalPricePaise) ||
    originalPricePaise < 0
  ) {
    return null;
  }
  return Math.floor((originalPricePaise * 110) / 100);
}
