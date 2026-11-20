import { cn } from "../../utils/classNames";

const TONE_CLASSES = {
  neutral: "bg-slate-100 text-slate-700 border-slate-200",
  info: "bg-skylight text-navy border-sky/40",
  success: "bg-green-50 text-success border-green-200",
  warning: "bg-amber-50 text-warning border-amber-200",
  danger: "bg-red-50 text-danger border-red-200",
};

/**
 * Compact status/category label using FairTicket color tones.
 * Tones: neutral, info, success, warning, danger.
 */
export default function Badge({
  children,
  tone = "neutral",
  className = "",
  ...rest
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium",
        TONE_CLASSES[tone] || TONE_CLASSES.neutral,
        className
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
