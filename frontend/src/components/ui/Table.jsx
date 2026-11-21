import { cn } from "../../utils/classNames";

/**
 * Responsive table wrapper that scrolls horizontally inside its own container on small screens.
 */
export default function Table({
  children,
  caption = "",
  className = "",
  tableClassName = "",
}) {
  return (
    <div
      className={cn(
        "w-full overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm",
        className
      )}
    >
      <table
        className={cn(
          "min-w-full divide-y divide-slate-200 text-left text-sm text-navy",
          tableClassName
        )}
      >
        {caption && <caption className="sr-only">{caption}</caption>}
        {children}
      </table>
    </div>
  );
}
