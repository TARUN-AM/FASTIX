import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { cn } from "../../utils/classNames";

const VARIANT_CLASSES = {
  primary:
    "bg-navy text-white border border-navy hover:bg-slate-800 active:bg-slate-900",
  secondary:
    "bg-white text-navy border border-slate-300 hover:bg-slate-50 active:bg-slate-100",
  ghost:
    "bg-transparent text-navy border border-transparent hover:bg-skylight/70 active:bg-skylight",
  danger:
    "bg-danger text-white border border-danger hover:bg-red-700 active:bg-red-800",
};

const SIZE_CLASSES = {
  sm: "px-3 py-1.5 text-xs gap-1.5",
  md: "px-4 py-2 text-sm gap-2",
  lg: "px-5 py-2.5 text-base gap-2",
};

/**
 * Reusable FairTicket Button.
 * Supports variants (primary, secondary, ghost, danger), sizes (sm, md, lg),
 * loading spinner, icons, fullWidth, and React Router Link via `to` or `as`.
 */
export default function Button({
  children,
  variant = "primary",
  size = "md",
  type = "button",
  isLoading = false,
  disabled = false,
  leftIcon = null,
  rightIcon = null,
  fullWidth = false,
  as = null,
  to = null,
  className = "",
  ...rest
}) {
  const isDisabled = disabled || isLoading;
  const classes = cn(
    "inline-flex items-center justify-center rounded-lg font-medium transition-colors duration-150",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky focus-visible:ring-offset-2",
    VARIANT_CLASSES[variant] || VARIANT_CLASSES.primary,
    SIZE_CLASSES[size] || SIZE_CLASSES.md,
    fullWidth && "w-full",
    isDisabled && "cursor-not-allowed opacity-60",
    className
  );

  const content = (
    <>
      {isLoading ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
      ) : (
        leftIcon && (
          <span className="inline-flex shrink-0" aria-hidden="true">
            {leftIcon}
          </span>
        )
      )}
      <span>{children}</span>
      {!isLoading && rightIcon && (
        <span className="inline-flex shrink-0" aria-hidden="true">
          {rightIcon}
        </span>
      )}
    </>
  );

  if (to) {
    const Component = as || Link;
    return (
      <Component
        to={to}
        className={classes}
        aria-disabled={isDisabled || undefined}
        tabIndex={isDisabled ? -1 : undefined}
        onClick={(event) => {
          if (isDisabled) {
            event.preventDefault();
            return;
          }
          if (rest.onClick) {
            rest.onClick(event);
          }
        }}
        {...rest}
      >
        {content}
      </Component>
    );
  }

  if (as) {
    const Component = as;
    return (
      <Component className={classes} disabled={isDisabled} {...rest}>
        {content}
      </Component>
    );
  }

  return (
    <button
      type={type}
      disabled={isDisabled}
      aria-busy={isLoading || undefined}
      className={classes}
      {...rest}
    >
      {content}
    </button>
  );
}
