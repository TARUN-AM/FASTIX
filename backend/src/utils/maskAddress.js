/**
 * Masks an Ethereum wallet address for audit logs and safe display so full
 * addresses are never written to SecurityLogs or console output.
 *
 * Example: "0x1234567890abcdef1234567890abcdef1234abcd" -> "0x1234...abcd"
 */
function maskAddress(address) {
  if (typeof address !== "string") {
    return "";
  }
  const trimmed = address.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.length <= 10) {
    return trimmed;
  }
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
}

module.exports = {
  maskAddress,
};
