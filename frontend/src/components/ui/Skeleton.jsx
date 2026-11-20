import { cn } from "../../utils/classNames";

/**
 * Subtle neutral loading placeholder block.
 */
export default function Skeleton({ className = "h-4 w-full" }) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-slate-200/80", className)}
    />
  );
}
