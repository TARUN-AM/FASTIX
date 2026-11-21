import { useId } from "react";
import { cn } from "../../utils/classNames";

/**
 * Accessible text input with label, hint, error message, and ARIA attributes.
 */
export default function Input({
  id,
  label = "",
  hint = "",
  error = "",
  required = false,
  className = "",
  inputClassName = "",
  ...rest
}) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("w-full", className)}>
      {label && (
        <label
          htmlFor={inputId}
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
      <input
        id={inputId}
        required={required}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={describedBy}
        className={cn(
          "block w-full rounded-lg border bg-white px-3.5 py-2 text-sm text-navy transition-colors duration-150",
          "placeholder:text-slate-400 focus:border-sky focus:outline-none focus:ring-2 focus:ring-sky/40",
          "disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500",
          error ? "border-danger focus:border-danger focus:ring-danger/30" : "border-slate-300",
          inputClassName
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
