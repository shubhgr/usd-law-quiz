"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";

type RefreshFn = () => void | Promise<void>;

const AdminRefreshContext = createContext<{
  registerRefresh: (fn: RefreshFn | null) => void;
  runRefresh: () => void;
} | null>(null);

export function AdminRefreshProvider({ children }: { children: ReactNode }) {
  const handlerRef = useRef<RefreshFn | null>(null);

  const registerRefresh = useCallback((fn: RefreshFn | null) => {
    handlerRef.current = fn;
  }, []);

  const runRefresh = useCallback(() => {
    void handlerRef.current?.();
  }, []);

  return (
    <AdminRefreshContext.Provider value={{ registerRefresh, runRefresh }}>
      {children}
    </AdminRefreshContext.Provider>
  );
}

export function useAdminRefresh(handler: RefreshFn) {
  const ctx = useContext(AdminRefreshContext);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!ctx) return;
    ctx.registerRefresh(() => handlerRef.current());
    return () => ctx.registerRefresh(null);
  }, [ctx]);
}

export function useAdminRefreshRunner() {
  const ctx = useContext(AdminRefreshContext);
  return ctx?.runRefresh ?? (() => undefined);
}
