import { cn } from "../../utils/classNames";

/**
 * Clean white card surface with thin slate border and subtle shadow.
 * Compose with CardHeader, CardBody, and CardFooter.
 */
export function Card({ children, className = "", ...rest }) {
  return (
    <div
      className={cn(
        "rounded-xl border border-slate-200 bg-white shadow-sm",
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className = "", ...rest }) {
  return (
    <div
      className={cn("border-b border-slate-100 px-5 py-4", className)}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardBody({ children, className = "", ...rest }) {
  return (
    <div className={cn("px-5 py-4", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardFooter({ children, className = "", ...rest }) {
  return (
    <div
      className={cn(
        "border-t border-slate-100 bg-slate-50/60 px-5 py-3.5 rounded-b-xl",
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export default Card;
