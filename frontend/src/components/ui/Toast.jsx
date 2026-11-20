import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "../../utils/classNames";

const ToastContext = createContext(null);

const TOAST_STYLES = {
  success: {
    container: "border-green-200 bg-white text-navy",
    iconColor: "text-success",
    Icon: CheckCircle2,
  },
  error: {
    container: "border-red-200 bg-white text-navy",
    iconColor: "text-danger",
    Icon: AlertCircle,
  },
  info: {
    container: "border-sky/50 bg-white text-navy",
    iconColor: "text-sky",
    Icon: Info,
  },
};

const AUTO_DISMISS_MS = 4000;

/**
 * Lightweight toast provider with success, error, and info notifications
 * that auto-dismiss after 4 seconds and can be dismissed manually.
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef(new Map());

  const dismissToast = useCallback((id) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const addToast = useCallback(
    (type, message) => {
      if (!message) {
        return;
      }
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setToasts((prev) => [...prev, { id, type, message }]);

      const timer = setTimeout(() => {
        dismissToast(id);
      }, AUTO_DISMISS_MS);
      timersRef.current.set(id, timer);
    },
    [dismissToast]
  );

  useEffect(() => {
    const activeTimers = timersRef.current;
    return () => {
      activeTimers.forEach((timer) => clearTimeout(timer));
      activeTimers.clear();
    };
  }, []);

  const api = useMemo(
    () => ({
      success: (message) => addToast("success", message),
      error: (message) => addToast("error", message),
      info: (message) => addToast("info", message),
      dismiss: dismissToast,
    }),
    [addToast, dismissToast]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2 px-4 sm:px-0"
      >
        {toasts.map((toast) => {
          const style = TOAST_STYLES[toast.type] || TOAST_STYLES.info;
          const IconComponent = style.Icon;
          return (
            <div
              key={toast.id}
              role={toast.type === "error" ? "alert" : "status"}
              className={cn(
                "pointer-events-auto flex items-start gap-2.5 rounded-lg border p-3.5 text-sm shadow-md",
                style.container
              )}
            >
              <IconComponent
                className={cn("mt-0.5 h-4 w-4 shrink-0", style.iconColor)}
                aria-hidden="true"
              />
              <p className="min-w-0 flex-1 text-slate-800">{toast.message}</p>
              <button
                type="button"
                onClick={() => dismissToast(toast.id)}
                aria-label="Dismiss notification"
                className="rounded p-0.5 text-slate-400 transition-colors duration-150 hover:bg-slate-100 hover:text-navy"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider.");
  }
  return context;
}

export default ToastProvider;
