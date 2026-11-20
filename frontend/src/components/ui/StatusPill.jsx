import Badge from "./Badge";

const GENERIC_STATUS_MAP = {
  ACTIVE: { tone: "success", label: "Active" },
  VERIFIED: { tone: "success", label: "Verified" },
  CONFIRMED: { tone: "success", label: "Confirmed" },
  COMPLETED: { tone: "success", label: "Completed" },
  SUCCEEDED: { tone: "success", label: "Succeeded" },
  SAFE: { tone: "success", label: "Safe" },
  CONNECTED: { tone: "success", label: "Connected" },
  BOOKED: { tone: "success", label: "Booked" },
  SOLD: { tone: "info", label: "Sold" },
  OPEN: { tone: "info", label: "Open" },
  REGISTERED: { tone: "info", label: "Registered" },
  ACTIVE_TURN: { tone: "info", label: "Your Turn" },
  LISTED_FOR_RESALE: { tone: "info", label: "Listed for Resale" },
  PENDING: { tone: "warning", label: "Pending" },
  WAITING: { tone: "warning", label: "Waiting" },
  CAUTION: { tone: "warning", label: "Caution" },
  PAYMENT_PENDING: { tone: "warning", label: "Payment Pending" },
  DRAFT: { tone: "neutral", label: "Draft" },
  USED: { tone: "neutral", label: "Used" },
  EXPIRED: { tone: "neutral", label: "Expired" },
  CANCELLED: { tone: "neutral", label: "Cancelled" },
  RELEASED: { tone: "neutral", label: "Released" },
  REJECTED: { tone: "danger", label: "Rejected" },
  FAILED: { tone: "danger", label: "Failed" },
  SUSPENDED: { tone: "danger", label: "Suspended" },
  REVOKED: { tone: "danger", label: "Revoked" },
  DANGEROUS: { tone: "danger", label: "Dangerous" },
  BLOCKED: { tone: "danger", label: "Blocked" },
};

function humanizeStatus(rawStatus) {
  if (!rawStatus || typeof rawStatus !== "string") {
    return "Unknown";
  }
  return rawStatus
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Maps an uppercase enum status string to a consistent Badge tone and readable label.
 */
export default function StatusPill({ status = "", className = "" }) {
  const key = typeof status === "string" ? status.trim().toUpperCase() : "";
  const match = GENERIC_STATUS_MAP[key];

  return (
    <Badge tone={match?.tone || "neutral"} className={className}>
      {match?.label || humanizeStatus(key)}
    </Badge>
  );
}
