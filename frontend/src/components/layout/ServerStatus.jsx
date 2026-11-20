import { useServerHealth } from "../../hooks/useServerHealth";
import { cn } from "../../utils/classNames";

/**
 * Compact backend connection indicator powered by the shared useServerHealth hook.
 * Reuses the single GET /api/v1/health request made across the app.
 */
export default function ServerStatus({ className = "" }) {
  const { status } = useServerHealth();

  const statusConfig =
    status === "connected"
      ? {
          dotClass: "bg-success",
          textClass: "text-slate-700",
          label: "API connected",
        }
      : status === "error"
      ? {
          dotClass: "bg-danger",
          textClass: "text-danger",
          label: "API unreachable",
        }
      : {
          dotClass: "bg-slate-400",
          textClass: "text-slate-500",
          label: "Checking API...",
        };

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium",
        statusConfig.textClass,
        className
      )}
    >
      <span
        aria-hidden="true"
        className={cn("h-2 w-2 shrink-0 rounded-full", statusConfig.dotClass)}
      />
      <span>{statusConfig.label}</span>
    </div>
  );
}
