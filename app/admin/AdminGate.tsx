"use client";

import Link from "next/link";
import {
  FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { clearAdminClientCache } from "./adminClientCache";
import {
  AdminRefreshProvider,
  useAdminRefreshRunner,
} from "./AdminRefresh";
import { AdminStickyToolsProvider } from "./AdminStickyTools";

type AdminSection = "participants" | "colleges";

function AdminChrome({
  section,
  children,
  onLogout,
}: {
  section: AdminSection;
  children: ReactNode;
  onLogout: () => void;
}) {
  const runRefresh = useAdminRefreshRunner();
  const stickyToolsRef = useRef<HTMLDivElement | null>(null);
  const [, bump] = useState(0);

  useEffect(() => {
    // Ensure portals can mount after the sticky tools target exists.
    bump((n) => n + 1);
  }, []);

  return (
    <main className="mx-auto min-h-dvh w-full max-w-5xl px-4 pb-8 sm:px-6">
      <div className="sticky top-0 z-40 -mx-4 border-b border-white/10 bg-[var(--background)] px-4 pt-6 pb-4 sm:-mx-6 sm:px-6">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <h1 className="text-2xl font-bold text-white sm:text-3xl">
            Leaderboard admin
          </h1>
          <nav className="flex justify-center gap-2">
            <Link
              href="/admin"
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                section === "participants"
                  ? "bg-white/10 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Participants
            </Link>
            <Link
              href="/admin/colleges"
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                section === "colleges"
                  ? "bg-white/10 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Colleges
            </Link>
          </nav>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              aria-label="Refresh"
              title="Refresh"
              onClick={() => runRefresh()}
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/15 text-slate-300 hover:border-white/30 hover:text-white"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M21 12a9 9 0 1 1-2.6-6.3" />
                <path d="M21 3v6h-6" />
              </svg>
            </button>
            <button
              type="button"
              aria-label="Log out"
              title="Log out"
              onClick={onLogout}
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/15 text-slate-300 hover:border-white/30 hover:text-white"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </div>
        </div>
        <div ref={stickyToolsRef} className="empty:hidden" />
      </div>

      <AdminStickyToolsProvider targetRef={stickyToolsRef}>
        <div className="mt-6">{children}</div>
      </AdminStickyToolsProvider>
    </main>
  );
}

export function AdminGate({
  section,
  children,
}: {
  section: AdminSection;
  children: ReactNode;
}) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);

  const checkAuth = useCallback(async () => {
    const res = await fetch("/api/admin/login");
    const body = (await res.json()) as {
      configured?: boolean;
      authenticated?: boolean;
    };
    setConfigured(Boolean(body.configured));
    setAuthenticated(Boolean(body.authenticated));
  }, []);

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setLoggingIn(true);
    setLoginError("");
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Login failed");
      setPassword("");
      setAuthenticated(true);
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoggingIn(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/admin/login", { method: "DELETE" });
    clearAdminClientCache();
    setAuthenticated(false);
  }

  if (configured === null) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-lg items-center justify-center px-5 text-slate-400">
        Loading…
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5">
        <form onSubmit={handleLogin} className="space-y-3">
          <label htmlFor="adminPassword" className="register-label">
            Password
          </label>
          <input
            id="adminPassword"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter admin password"
            className="register-input w-full"
            autoFocus
            autoComplete="current-password"
          />
          {loginError && <p className="text-sm text-red-300">{loginError}</p>}
          <button
            type="submit"
            disabled={loggingIn || !password}
            className="register-btn-primary"
          >
            {loggingIn ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </main>
    );
  }

  return (
    <AdminRefreshProvider>
      <AdminChrome section={section} onLogout={() => void handleLogout()}>
        {children}
      </AdminChrome>
    </AdminRefreshProvider>
  );
}
