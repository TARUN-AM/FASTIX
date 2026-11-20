import { cn } from "../../utils/classNames";

/**
 * Consistent page heading block with optional breadcrumb text, subtitle, and right-aligned actions.
 */
export default function PageHeader({
  title = "",
  subtitle = "",
  breadcrumb = "",
  actions = null,
  className = "",
}) {
  return (
    <div
      className={cn(
        "mb-6 flex flex-col gap-3 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between",
        className
      )}
    >
      <div className="min-w-0">
        {breadcrumb && (
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
            {breadcrumb}
          </p>
        )}
        <h1 className="text-2xl font-bold tracking-tight text-navy sm:text-3xl">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1.5 text-sm text-slate-600">{subtitle}</p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      )}
    </div>
  );
}
