import { Clock } from "lucide-react";
import { cn } from "../../utils/classNames";
import { formatCountdown } from "../../utils/formatDate";

/**
 * Purely visual mm:ss countdown display component.
 * IMPORTANT: This component does NOT own timer state or extend holds.
 * The real countdown deadline (expiresAt) is strictly controlled by the backend (Prompt 12).
 */
export default function CountdownDisplay({
  remainingSeconds = 0,
  label = "Time remaining",
  className = "",
}) {
  const safeSeconds =
    typeof remainingSeconds === "number" && Number.isFinite(remainingSeconds)
      ? Math.max(0, Math.floor(remainingSeconds))
      : 0;
  const isUrgent = safeSeconds > 0 && safeSeconds < 60;
  const isExpired = safeSeconds === 0;

  return (
    <div
      aria-live="off"
      className={cn(
        "inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-semibold tabular-nums",
        isExpired && "border-slate-200 bg-slate-100 text-slate-500",
        isUrgent && "border-red-200 bg-red-50 text-danger",
        !isExpired && !isUrgent && "border-sky/40 bg-skylight/60 text-navy",
        className
      )}
    >
      <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="sr-only">{label}:</span>
      <span>{formatCountdown(safeSeconds)}</span>
    </div>
  );
}
