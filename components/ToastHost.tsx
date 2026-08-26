"use client";

import { useEffect, useState } from "react";
import { subscribeToasts, type ToastKind } from "@/lib/toast";

interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

const DISMISS_MS = 8000;

export default function ToastHost() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    return subscribeToasts(({ message, kind = "error" }) => {
      const id = Date.now() + Math.random();
      setToasts((current) => [...current, { id, message, kind }]);
      window.setTimeout(() => {
        setToasts((current) => current.filter((toast) => toast.id !== id));
      }, DISMISS_MS);
    });
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-6 z-[100] flex flex-col items-center gap-2 px-4"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className={`pointer-events-auto flex max-w-md items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg ${
            toast.kind === "error"
              ? "border-red-500/40 bg-red-950/90 text-red-200"
              : "border-white/15 bg-[#001426]/95 text-white"
          }`}
        >
          <p className="min-w-0 flex-1">{toast.message}</p>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() =>
              setToasts((current) => current.filter((item) => item.id !== toast.id))
            }
            className="shrink-0 text-current/70 hover:text-current"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
