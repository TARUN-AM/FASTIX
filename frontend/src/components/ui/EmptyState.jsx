import { Inbox } from "lucide-react";
import { cn } from "../../utils/classNames";

/**
 * Standardized empty / upcoming section state with icon, title, description, and optional action.
 */
export default function EmptyState({
  icon = null,
  title = "Nothing here yet",
  description = "",
  action = null,
  className = "",
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-white px-6 py-12 text-center shadow-sm",
        className
      )}
    >
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-skylight text-navy">
        {icon || <Inbox className="h-6 w-6" aria-hidden="true" />}
      </div>
      <h2 className="text-lg font-semibold text-navy">{title}</h2>
      {description && (
        <p className="mt-2 max-w-md text-sm text-slate-600">{description}</p>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
