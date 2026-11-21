import { Check } from "lucide-react";
import { cn } from "../../utils/classNames";

/**
 * Horizontal step indicator supporting completed, current, and upcoming states.
 * Collapses cleanly into a vertical stack on narrow mobile screens.
 *
 * Each step item: { label: string, description?: string, status: "completed" | "current" | "upcoming" }
 */
export default function Stepper({ steps = [], className = "" }) {
  return (
    <nav aria-label="Progress steps" className={cn("w-full", className)}>
      <ol className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-0">
        {steps.map((step, index) => {
          const isCompleted = step.status === "completed";
          const isCurrent = step.status === "current";
          const isLast = index === steps.length - 1;

          return (
            <li
              key={step.label || index}
              aria-current={isCurrent ? "step" : undefined}
              className={cn(
                "relative flex items-start gap-3 sm:flex-1 sm:flex-col sm:items-center sm:text-center",
                !isLast && "sm:pr-4"
              )}
            >
              {!isLast && (
                <div
                  aria-hidden="true"
                  className={cn(
                    "hidden sm:block sm:absolute sm:left-1/2 sm:top-4 sm:h-0.5 sm:w-full",
                    isCompleted ? "bg-success" : "bg-slate-200"
                  )}
                />
              )}

              <div
                className={cn(
                  "relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors duration-150",
                  isCompleted && "border-success bg-success text-white",
                  isCurrent && "border-navy bg-skylight text-navy",
                  !isCompleted && !isCurrent && "border-slate-300 bg-white text-slate-500"
                )}
              >
                {isCompleted ? (
                  <Check className="h-4 w-4" aria-hidden="true" />
                ) : (
                  index + 1
                )}
              </div>

              <div className="min-w-0 sm:mt-2 sm:px-1">
                <p
                  className={cn(
                    "text-sm font-medium",
                    isCurrent || isCompleted ? "text-navy" : "text-slate-500"
                  )}
                >
                  {step.label}
                </p>
                {step.description && (
                  <p className="mt-0.5 text-xs text-slate-500">
                    {step.description}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
