// One polite live region, bottom-centre. `useToast().show(message, { action })` queues a transient
// confirmation that hides itself after TOAST_MS; an optional action (Undo) stays clickable while
// it is visible. Toasts are feedback only: they never carry state the user must act on.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

export const TOAST_MS = 4500;

export interface ToastAction {
  readonly label: string;
  readonly onAction: () => void;
}

export interface ToastOptions {
  readonly action?: ToastAction;
  /** Override the auto-hide delay (ms). */
  readonly durationMs?: number;
}

interface ToastItem {
  readonly id: number;
  readonly message: string;
  readonly action?: ToastAction;
  readonly durationMs: number;
}

export interface ToastApi {
  readonly show: (message: string, options?: ToastOptions) => void;
}

const NOOP: ToastApi = { show: () => undefined };
const ToastContext = createContext<ToastApi>(NOOP);

/** Toast API for the current tree. Outside a provider it is a harmless no-op. */
export function useToast(): ToastApi {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const [toasts, setToasts] = useState<readonly ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (message: string, options?: ToastOptions) => {
      const id = nextId.current++;
      const durationMs = options?.durationMs ?? TOAST_MS;
      // Keep at most three on screen; the oldest yields to the newest.
      setToasts((prev) => [...prev.slice(-2), { id, message, durationMs, ...(options?.action ? { action: options.action } : {}) }]);
      timers.current.set(id, setTimeout(() => dismiss(id), durationMs));
    },
    [dismiss],
  );

  useEffect(() => {
    const live = timers.current;
    return () => {
      for (const timer of live.values()) clearTimeout(timer);
      live.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-region" role="status" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            <span className="toast-message">{t.message}</span>
            {t.action && (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  t.action?.onAction();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
