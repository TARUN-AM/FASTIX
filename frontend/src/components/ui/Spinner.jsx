import { Loader2 } from "lucide-react";
import { cn } from "../../utils/classNames";

const SIZE_CLASSES = {
  sm: "h-4 w-4",
  md: "h-6 w-6",
  lg: "h-8 w-8",
};

/**
 * Simple loading spinner using Lucide Loader2.
 */
export default function Spinner({
  size = "md",
  label = "Loading",
  className = "",
}) {
  return (
    <span
      role="status"
      aria-label={label}
      className={cn("inline-flex items-center justify-center", className)}
    >
      <Loader2
        className={cn(
          "animate-spin text-sky",
          SIZE_CLASSES[size] || SIZE_CLASSES.md
        )}
        aria-hidden="true"
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}
