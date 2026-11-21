import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "../../utils/classNames";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Accessible modal dialog implemented with zero external dependencies.
 * Supports Escape close, backdrop click close, body scroll lock, focus trap, and focus restoration.
 */
export default function Modal({
  isOpen = false,
  onClose = () => {},
  title = "",
  children,
  footer = null,
  size = "md",
  className = "",
}) {
  const titleId = useId();
  const dialogRef = useRef(null);
  const previousFocusRef = useRef(null);

  const sizeClass =
    size === "sm"
      ? "max-w-md"
      : size === "lg"
      ? "max-w-2xl"
      : "max-w-lg";

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    previousFocusRef.current = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const dialogNode = dialogRef.current;
    if (dialogNode) {
      const focusables = dialogNode.querySelectorAll(FOCUSABLE_SELECTOR);
      if (focusables.length > 0) {
        focusables[0].focus();
      } else {
        dialogNode.focus();
      }
    }

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key === "Tab" && dialogRef.current) {
        const focusables = Array.from(
          dialogRef.current.querySelectorAll(FOCUSABLE_SELECTOR)
        );
        if (focusables.length === 0) {
          event.preventDefault();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (
        previousFocusRef.current &&
        typeof previousFocusRef.current.focus === "function"
      ) {
        previousFocusRef.current.focus();
      }
    };
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-navy/50 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={cn(
          "w-full rounded-xl border border-slate-200 bg-white shadow-lg",
          sizeClass,
          className
        )}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          {title ? (
            <h2 id={titleId} className="text-base font-semibold text-navy">
              {title}
            </h2>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-md p-1.5 text-slate-500 transition-colors duration-150 hover:bg-slate-100 hover:text-navy"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto px-5 py-4 text-sm text-slate-700">
          {children}
        </div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/70 px-5 py-3.5 rounded-b-xl">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
