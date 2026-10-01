"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { collection, query, where } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { CircleAlert, CircleCheck, X } from "lucide-react";
import { roleCan, roleFromClaims, type ConsoleCapability, type ConsoleRole } from "@/features/console/roles";
import type { ConsoleStudio } from "@/features/console/model";
import { getFirebaseClient } from "@/lib/firebase/client";
import { authIsLive } from "@/lib/runtime-mode";
import { useLiveQuery, type LiveState } from "@/lib/console/live";

/**
 * What every Console page shares: who is signed in and in what role, the
 * studio rows (read once, used by the rail, ⌘K, the Studios table and every
 * page that names a studio), toasts, and the viewer's theme and density.
 */

type Toast = { id: number; tone: "ok" | "bad" | "info"; message: string };
type Theme = "system" | "light" | "dark";
type Density = "comfortable" | "compact";

type ConsoleValue = {
  role: ConsoleRole | null;
  can: (capability: ConsoleCapability) => boolean;
  user: { uid: string; email: string | null; name: string | null } | null;
  studios: LiveState<ConsoleStudio>;
  studioById: (tenantId: string | null | undefined) => ConsoleStudio | undefined;
  toast: (message: string, tone?: Toast["tone"]) => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  navOpen: boolean;
  setNavOpen: (open: boolean) => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  density: Density;
  setDensity: (density: Density) => void;
};

const ConsoleContext = createContext<ConsoleValue | null>(null);

function stored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const value = window.localStorage.getItem(key);
    return allowed.includes(value as T) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private windows refuse storage; the choice lasts for this visit.
  }
}

export function ConsoleProvider({ children }: { children: React.ReactNode }) {
  const [role, setRole] = useState<ConsoleRole | null>(authIsLive ? null : "owner");
  const [user, setUser] = useState<ConsoleValue["user"]>(authIsLive ? null : { uid: "preview", email: null, name: "Preview" });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  // The Console mounts only after AuthBoundary has checked the session in the
  // browser, so reading storage while initialising never meets a server render.
  const [theme, setThemeState] = useState<Theme>(() => stored("studiocue.console.theme", ["system", "light", "dark"] as const, "system"));
  const [density, setDensityState] = useState<Density>(() => stored("studiocue.console.density", ["comfortable", "compact"] as const, "comfortable"));
  const nextId = useRef(1);

  useEffect(() => {
    if (!authIsLive) return;
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, (current) => {
      if (!current) {
        setUser(null);
        setRole(null);
        return;
      }
      setUser({ uid: current.uid, email: current.email, name: current.displayName });
      void current.getIdTokenResult().then((token) => setRole(roleFromClaims(token.claims)));
    });
  }, []);

  const studios = useLiveQuery<ConsoleStudio>("console:studios", (firestore) =>
    query(collection(firestore, "consoleStudios"), where("removed", "==", false)),
  );
  const byId = useMemo(() => new Map((studios.rows ?? []).map((studio) => [studio.tenantId, studio])), [studios.rows]);

  const toast = useCallback((message: string, tone: Toast["tone"] = "ok") => {
    const id = nextId.current++;
    setToasts((current) => [...current.slice(-3), { id, tone, message }]);
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), tone === "bad" ? 9000 : 4500);
  }, []);

  const value = useMemo<ConsoleValue>(
    () => ({
      role,
      can: (capability) => roleCan(role, capability),
      user,
      studios,
      studioById: (tenantId) => (tenantId ? byId.get(tenantId) : undefined),
      toast,
      paletteOpen,
      setPaletteOpen,
      navOpen,
      setNavOpen,
      theme,
      setTheme: (next) => {
        setThemeState(next);
        store("studiocue.console.theme", next);
      },
      density,
      setDensity: (next) => {
        setDensityState(next);
        store("studiocue.console.density", next);
      },
    }),
    [role, user, studios, byId, toast, paletteOpen, navOpen, theme, density],
  );

  return (
    <ConsoleContext.Provider value={value}>
      {/* The scoped root wraps the toasts too, or they render unstyled. */}
      <div className="cx-root" data-density={density === "compact" ? "compact" : undefined} data-theme={theme === "system" ? undefined : theme}>
      {children}
      <div className="cx-toasts" aria-live="polite" role="status">
        {toasts.map((item) => (
          <div className="cx-toast" data-tone={item.tone} key={item.id}>
            {item.tone === "bad" ? <CircleAlert size={15} /> : <CircleCheck size={15} />}
            <span>{item.message}</span>
            <button
              aria-label="Dismiss"
              className="cx-toast-close"
              onClick={() => setToasts((current) => current.filter((toastItem) => toastItem.id !== item.id))}
              type="button"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
      </div>
    </ConsoleContext.Provider>
  );
}

export function useConsole(): ConsoleValue {
  const value = useContext(ConsoleContext);
  if (!value) throw new Error("useConsole must be used inside the Console shell");
  return value;
}
