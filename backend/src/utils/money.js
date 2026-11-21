const {
  RESALE_CAP_PERCENT,
  SCALPING_WARNING_MULTIPLIER,
} = require("../config/constants");

function isValidPaise(value) {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0
  );
}

function assertValidPaise(value, fieldName = "amountPaise") {
  if (!isValidPaise(value)) {
    throw new TypeError(`${fieldName} must be a whole number of paise.`);
  }
}

function calculateMaxResalePrice(originalPricePaise) {
  assertValidPaise(originalPricePaise, "originalPricePaise");
  return Math.floor((originalPricePaise * RESALE_CAP_PERCENT) / 100);
}

function isScalpingPrice(originalPricePaise, attemptedPricePaise) {
  assertValidPaise(originalPricePaise, "originalPricePaise");
  assertValidPaise(attemptedPricePaise, "attemptedPricePaise");
  return attemptedPricePaise >= originalPricePaise * SCALPING_WARNING_MULTIPLIER;
}

function formatRupees(paise) {
  assertValidPaise(paise, "paise");
  const wholeRupees = Math.floor(paise / 100);
  const remainingPaise = String(paise % 100).padStart(2, "0");
  return `Rs ${wholeRupees.toLocaleString("en-IN")}.${remainingPaise}`;
}

const paiseSchemaValidator = Object.freeze({
  validator: isValidPaise,
  message: "must be a whole number of paise",
});

module.exports = {
  isValidPaise,
  assertValidPaise,
  calculateMaxResalePrice,
  isScalpingPrice,
  formatRupees,
  paiseSchemaValidator,
};
