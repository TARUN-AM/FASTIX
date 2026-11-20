import { useId } from "react";
import { cn } from "../../utils/classNames";

/**
 * Accessible multiline textarea with label, hint, error message, and ARIA attributes.
 */
export default function Textarea({
  id,
  label = "",
  hint = "",
  error = "",
  required = false,
  rows = 4,
  className = "",
  textareaClassName = "",
  ...rest
}) {
  const generatedId = useId();
  const textareaId = id || generatedId;
  const hintId = hint ? `${textareaId}-hint` : undefined;
  const errorId = error ? `${textareaId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("w-full", className)}>
      {label && (
        <label
          htmlFor={textareaId}
          className="mb-1.5 block text-sm font-medium text-navy"
        >
          {label}
          {required && (
            <span className="ml-1 text-danger" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}
      <textarea
        id={textareaId}
        rows={rows}
        required={required}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={describedBy}
        className={cn(
          "block w-full rounded-lg border bg-white px-3.5 py-2 text-sm text-navy transition-colors duration-150",
          "placeholder:text-slate-400 focus:border-sky focus:outline-none focus:ring-2 focus:ring-sky/40",
          "disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500",
          error ? "border-danger focus:border-danger focus:ring-danger/30" : "border-slate-300",
          textareaClassName
        )}
        {...rest}
      />
      {hint && !error && (
        <p id={hintId} className="mt-1.5 text-xs text-slate-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="mt-1.5 text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
