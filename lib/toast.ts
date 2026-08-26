export type ToastKind = "error" | "info";

export interface ToastPayload {
  message: string;
  kind?: ToastKind;
}

const EVENT = "usd-toast";

export function showToast(message: string, kind: ToastKind = "error") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<ToastPayload>(EVENT, { detail: { message, kind } })
  );
}

export function subscribeToasts(handler: (payload: ToastPayload) => void) {
  if (typeof window === "undefined") return () => {};
  const listener = (event: Event) => {
    handler((event as CustomEvent<ToastPayload>).detail);
  };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
