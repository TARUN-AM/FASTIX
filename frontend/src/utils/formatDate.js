/**
 * Formats an ISO date string into a readable local date & time string.
 * Returns "Invalid date" safely if input cannot be parsed.
 */
export function formatDateTime(isoString) {
  if (!isoString) {
    return "Invalid date";
  }

  const parsed = new Date(isoString);
  if (Number.isNaN(parsed.getTime())) {
    return "Invalid date";
  }

  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

/**
 * Formats a non-negative integer number of seconds as "MM:SS" (e.g. 299 -> "04:59").
 * Handles invalid or negative values safely by returning "00:00".
 */
export function formatCountdown(totalSeconds) {
  if (
    typeof totalSeconds !== "number" ||
    !Number.isFinite(totalSeconds) ||
    totalSeconds <= 0
  ) {
    return "00:00";
  }

  const wholeSeconds = Math.floor(totalSeconds);
  const minutes = Math.floor(wholeSeconds / 60);
  const seconds = wholeSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
