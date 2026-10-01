"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { collection, getDocs, limit, query, where } from "firebase/firestore";
import { Building2, Menu, Monitor, Moon, Search, Sun } from "lucide-react";
import { CueMark } from "@/components/brand/logo";
import { AuthBoundary, SignOutButton } from "@/features/auth/auth-boundary";
import { isStudioMembership } from "@/features/auth/workspace-routing";
import type { Role } from "@/features/auth/roles";
import { CONSOLE_ROLE_LABELS } from "@/features/console/roles";
import { triageOf } from "@/features/console/inbox";
import { getFirebaseClient } from "@/lib/firebase/client";
import { dataIsLive } from "@/lib/runtime-mode";
import { useLiveQuery } from "@/lib/console/live";
import { useJobs } from "@/lib/console/jobs";
import { useNow } from "@/lib/console/use-now";
import { runConsoleCommand } from "@/lib/console/command-client";
import { friendlyError } from "@/lib/ai/friendly-error";
import { ConsoleProvider, useConsole } from "./console-context";
import { CommandPalette } from "./command-palette";
import { Avatar } from "./ui";
import { CONSOLE_NAV } from "./nav";

/**
 * The StudioCue Console's frame (docs/console.md): the rail, the counts on it,
 * ⌘K, and the providers every page shares. Mounted once by
 * app/platform-admin/layout.tsx, so moving between pages keeps the rail and
 * its live data instead of re-reading everything.
 */

function useNavCounts() {
  const { studios } = useConsole();
  const feedback = useLiveQuery<Record<string, unknown>>("nav:feedback", (firestore) =>
    query(collection(firestore, "feedback"), where("status", "==", "received"), limit(300)),
  );
  const tasks = useLiveQuery<Record<string, unknown>>("nav:tasks", (firestore) =>
    query(collection(firestore, "consoleTasks"), where("status", "==", "open"), limit(300)),
  );
  const deletions = useLiveQuery<Record<string, unknown>>("nav:deletions", (firestore) =>
    query(collection(firestore, "deletionRequests"), where("status", "==", "cooling_off"), limit(100)),
  );
  const jobs = useJobs("failed");
  const now = useNow();
  return {
    studios: { value: studios.rows?.filter((studio) => studio.lifecycle !== "churned").length ?? null, tone: undefined },
    inbox: { value: (feedback.rows ?? []).filter((item) => triageOf(item) === "new").length, tone: "bad" as const },
    tasks: {
      value: tasks.rows?.length ?? 0,
      tone: (tasks.rows ?? []).some((task) => typeof task.dueAt === "string" && Date.parse(task.dueAt) < now) ? ("bad" as const) : undefined,
    },
    jobs: { value: (jobs.rows ?? []).filter((job) => !job.dismissedAt).length, tone: "bad" as const },
    data: { value: deletions.rows?.length ?? 0, tone: undefined },
  };
}

function isActive(pathname: string, href: string) {
  if (href === "/platform-admin") return pathname === "/platform-admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Jump to the admin's own studio, or restore their owner seat on one they created. */
function StudioShortcut() {
  const router = useRouter();
  const [memberships, setMemberships] = useState<string[]>([]);
  const [recoverable, setRecoverable] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!dataIsLive) return;
    const { auth, firestore } = getFirebaseClient();
    const user = auth.currentUser;
    if (!user) return;
    void Promise.all([
      getDocs(query(collection(firestore, "memberships"), where("userId", "==", user.uid), where("status", "==", "active"), limit(20))),
      getDocs(query(collection(firestore, "tenants"), where("createdBy", "==", user.uid), limit(20))),
    ])
      .then(([membershipSnapshot, tenantSnapshot]) => {
        const studio = membershipSnapshot.docs
          .map((item) => ({ tenantId: String(item.data().tenantId ?? ""), role: String(item.data().role ?? "") as Role }))
          .filter((membership) => membership.tenantId && isStudioMembership(membership))
          .map((membership) => membership.tenantId);
        setMemberships(studio);
        setRecoverable(tenantSnapshot.docs.find((tenant) => !studio.includes(tenant.id))?.id ?? null);
      })
      .catch(() => setNotice("Couldn't check your studios."));
  }, []);

  if (!memberships.length && !recoverable) return notice ? <span className="cx-hint">{notice}</span> : null;
  const open = () => {
    if (memberships.length === 1) {
      try {
        window.localStorage.setItem("studiohub.activeTenantId", memberships[0]!);
      } catch {
        // The workspace chooser covers a refused write.
      }
      router.push("/studio");
    } else {
      router.push("/auth/workspaces");
    }
  };
  const recover = async () => {
    if (!recoverable) return;
    try {
      await runConsoleCommand("repairOwnerMembership", { tenantId: recoverable });
      window.localStorage.setItem("studiohub.activeTenantId", recoverable);
      router.push("/studio");
    } catch (caught) {
      setNotice(friendlyError(caught, "Owner access couldn't be restored."));
    }
  };
  return (
    <>
      <button className="cx-btn" onClick={memberships.length ? open : () => void recover()} type="button">
        <Building2 size={14} />
        {memberships.length ? "Open my studio" : "Restore my studio access"}
      </button>
      {notice ? <span className="cx-hint">{notice}</span> : null}
    </>
  );
}

function Rail() {
  const pathname = usePathname() ?? "";
  const { role, user, setPaletteOpen, theme, setTheme, setNavOpen } = useConsole();
  const counts = useNavCounts();
  const ThemeIcon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;
  const nextTheme = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
  return (
    <aside aria-label="Console" className="cx-rail" id="console-navigation">
      <Link className="cx-rail-brand" href="/platform-admin" onClick={() => setNavOpen(false)}>
        <CueMark size={22} />
        <span>StudioCue</span>
        <span className="cx-rail-brand-tag">Console</span>
      </Link>
      <button className="cx-rail-search" onClick={() => setPaletteOpen(true)} type="button">
        <Search size={13} />
        Search studios, people…
        <kbd className="cx-kbd">⌘K</kbd>
      </button>
      <nav aria-label="Console sections">
        {CONSOLE_NAV.map((section) => (
          <div className="cx-nav-group" key={section.group ?? "top"}>
            {section.group ? <span className="cx-nav-label">{section.group}</span> : null}
            {section.items.map((item) => {
              const Icon = item.icon;
              const count = item.count ? counts[item.count] : null;
              return (
                <Link
                  aria-current={isActive(pathname, item.href) ? "page" : undefined}
                  className="cx-nav-item"
                  href={item.href}
                  key={item.href}
                  onClick={() => setNavOpen(false)}
                >
                  <Icon size={15} strokeWidth={1.8} />
                  {item.label}
                  {count && count.value ? (
                    <span className="cx-nav-count" data-tone={count.tone}>
                      {count.value}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="cx-rail-foot">
        <StudioShortcut />
        <div className="cx-rail-me">
          <Avatar name={user?.name ?? user?.email ?? "?"} round />
          <span className="cx-rail-me-text">
            <b>{user?.name ?? user?.email ?? "Signed in"}</b>
            <span>{role ? CONSOLE_ROLE_LABELS[role] : "Checking access…"}</span>
          </span>
        </div>
        <div className="cx-rail-row">
          <button
            aria-label={`Theme: ${theme}. Switch to ${nextTheme}.`}
            className="cx-btn"
            data-icon="true"
            onClick={() => setTheme(nextTheme)}
            title={`Theme: ${theme}`}
            type="button"
          >
            <ThemeIcon size={14} />
          </button>
          <SignOutButton className="cx-btn" />
        </div>
      </div>
    </aside>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const { navOpen, setNavOpen, setPaletteOpen } = useConsole();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }
      const target = event.target as HTMLElement | null;
      const typing = target?.closest("input, textarea, select, [contenteditable='true']");
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
      // "/" jumps to the page's filter box.
      if (event.key === "/") {
        const search = document.querySelector<HTMLInputElement>(".cx-search input");
        if (search) {
          event.preventDefault();
          search.focus();
        }
      }
      // j or ↓ from nowhere starts on the first row of the page's table.
      if ((event.key === "j" || event.key === "ArrowDown") && (!target || target === document.body)) {
        const first = document.querySelector<HTMLElement>(".cx-row[tabindex]");
        if (first) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [setPaletteOpen]);
  return (
    <>
      <div className="cx-shell" data-nav-open={navOpen ? "true" : undefined}>
        <button aria-label="Close navigation" className="cx-rail-backdrop" onClick={() => setNavOpen(false)} type="button" />
        <Rail />
        <main className="cx-main">{children}</main>
      </div>
      <CommandPalette />
    </>
  );
}

export function ConsoleFrame({ children }: { children: ReactNode }) {
  return (
    <AuthBoundary area="platform">
      <ConsoleProvider>
        <Shell>{children}</Shell>
      </ConsoleProvider>
    </AuthBoundary>
  );
}

/** The bar at the top of every page: breadcrumbs, and the page's own actions. */
export function Topbar({ crumbs, children }: { crumbs: Array<{ label: string; href?: string }>; children?: ReactNode }) {
  const { navOpen, setNavOpen } = useConsole();
  const title = useMemo(() => crumbs.map((crumb) => crumb.label).reverse().join(" · "), [crumbs]);
  useEffect(() => {
    document.title = `${title} · StudioCue Console`;
  }, [title]);
  return (
    <header className="cx-topbar">
      <button
        aria-controls="console-navigation"
        aria-expanded={navOpen}
        aria-label="Open navigation"
        className="cx-btn cx-mobile-menu"
        data-icon="true"
        data-variant="ghost"
        onClick={() => setNavOpen(true)}
        type="button"
      >
        <Menu size={16} />
      </button>
      <nav aria-label="Breadcrumb" className="cx-crumbs">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <span className="cx-inline" key={`${crumb.label}-${index}`}>
              {index > 0 ? <span aria-hidden>/</span> : null}
              {last ? <b aria-current="page">{crumb.label}</b> : crumb.href ? <Link href={crumb.href}>{crumb.label}</Link> : <span>{crumb.label}</span>}
            </span>
          );
        })}
      </nav>
      {children ? <div className="cx-topbar-actions">{children}</div> : null}
    </header>
  );
}
