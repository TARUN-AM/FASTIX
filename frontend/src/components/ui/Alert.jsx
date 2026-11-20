import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  X,
} from "lucide-react";
import { cn } from "../../utils/classNames";

const VARIANT_CONFIG = {
  info: {
    container: "border-sky/40 bg-skylight/50 text-navy",
    iconColor: "text-navy",
    Icon: Info,
    role: "status",
  },
  success: {
    container: "border-green-200 bg-green-50 text-navy",
    iconColor: "text-success",
    Icon: CheckCircle2,
    role: "status",
  },
  warning: {
    container: "border-amber-200 bg-amber-50 text-navy",
    iconColor: "text-warning",
    Icon: AlertTriangle,
    role: "alert",
  },
  danger: {
    container: "border-red-200 bg-red-50 text-navy",
    iconColor: "text-danger",
    Icon: AlertCircle,
    role: "alert",
  },
};

/**
 * Feedback banner supporting info, success, warning, and danger variants.
 * Uses role="alert" for warning and danger states.
 */
export default function Alert({
  variant = "info",
  title = "",
  children,
  onDismiss = null,
  className = "",
}) {
  const cfg = VARIANT_CONFIG[variant] || VARIANT_CONFIG.info;
  const IconComponent = cfg.Icon;

  return (
    <div
      role={cfg.role}
      className={cn(
        "flex items-start gap-3 rounded-lg border px-4 py-3 text-sm",
        cfg.container,
        className
      )}
    >
      <IconComponent
        className={cn("mt-0.5 h-5 w-5 shrink-0", cfg.iconColor)}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold text-navy">{title}</p>}
        {children && <div className={cn(title && "mt-0.5", "text-slate-700")}>{children}</div>}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss alert"
          className="rounded-md p-1 text-slate-500 transition-colors duration-150 hover:bg-white/70 hover:text-navy"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
