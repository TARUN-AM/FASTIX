import { cn } from "../../utils/classNames";

/**
 * Centered responsive container providing consistent horizontal padding across pages.
 */
export default function PageContainer({ children, className = "" }) {
  return (
    <div
      className={cn("mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8", className)}
    >
      {children}
    </div>
  );
}
