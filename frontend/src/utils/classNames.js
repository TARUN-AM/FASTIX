/**
 * Joins truthy class name strings together cleanly.
 */
export function cn(...classes) {
  return classes
    .filter((item) => typeof item === "string" && item.trim().length > 0)
    .join(" ");
}
