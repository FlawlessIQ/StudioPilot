"use client";

import type { CSSProperties } from "react";
import { createContext, useContext } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CircleAlert,
  FolderOpen,
  Home,
  ListChecks,
  LoaderCircle,
  MessageCircle,
  UserRound,
} from "lucide-react";
import { AuthBoundary } from "@/features/auth/auth-boundary";
import {
  useWorkspace,
  WorkspaceProvider,
} from "@/features/auth/workspace-context";
import { AppBar, KitRoot, TabBar, type Studio, type Tab } from "@/components/kit/kit";
import { HowToButton } from "@/components/help/how-to";
import { portalAccentStyle } from "@/features/design/studio-theme";

const PortalShellContext = createContext(false);

/**
 * The couple's four tabs (decided 2026-09-28,
 * docs/mobile-first-client-crew-plan-2026-09-28.md). Plan holds everything
 * that comes and goes by stage — proposal, agreement, payments, planning
 * form, timeline — where "More" used to open a drawer that hid them.
 */
export const clientTabs: readonly Tab[] = [
  { label: "Home", href: "/client", icon: Home },
  { label: "Plan", href: "/client/plan", icon: ListChecks },
  { label: "Messages", href: "/client/messages", icon: MessageCircle },
  { label: "Files", href: "/client/documents", icon: FolderOpen },
];

/** Which tab a route belongs to. */
export function clientTabFor(pathname: string): string {
  const segment = pathname.split("/").filter(Boolean)[1] ?? "";
  if (!segment) return "Home";
  if (segment === "messages") return "Messages";
  if (["documents", "delivery", "reviews"].includes(segment)) return "Files";
  return "Plan";
}

/**
 * Screens rebuilt in the mobile kit, which bring their own layout. Every
 * other client route still renders its design-system page inside a wrapper
 * that keeps the tokens it needs, until its turn comes.
 */
export const KIT_CLIENT_ROUTES = new Set([
  "/client",
  "/client/plan",
  "/client/proposal",
  "/client/contract",
  "/client/payments",
  "/client/questionnaire",
  "/client/schedule",
  "/client/messages",
  "/client/documents",
  "/client/delivery",
  "/client/reviews",
  "/client/project",
  "/client/package",
]);

export function PortalShell({
  children,
  active,
  projectName,
  projectDate,
}: {
  children: React.ReactNode;
  active?: string;
  projectName?: string;
  projectDate?: string;
}) {
  const shellMounted = useContext(PortalShellContext);
  if (shellMounted) return <>{children}</>;
  return (
    <PortalShellContext.Provider value>
      <WorkspaceProvider area="client">
        <AuthBoundary area="client">
          <ClientPortalShell
            active={active}
            projectName={projectName}
            projectDate={projectDate}
          >
            {children}
          </ClientPortalShell>
        </AuthBoundary>
      </WorkspaceProvider>
    </PortalShellContext.Provider>
  );
}

function ClientPortalShell({
  children,
}: {
  children: React.ReactNode;
  active?: string;
  projectName?: string;
  projectDate?: string;
}) {
  const pathname = usePathname();
  const workspace = useWorkspace();
  const brand = workspace.tenantBrand;
  const studio: Studio = {
    name: brand?.brandName ?? workspace.tenantName,
    color: brand?.primaryColor ?? null,
    logoUrl: brand?.logoUrl ?? null,
  };

  if (workspace.loading) return <ClientPortalLoadingShell />;

  const kit = KIT_CLIENT_ROUTES.has(pathname);
  return (
    <KitRoot studio={studio}>
      <div className="kit-screen" data-width={kit ? undefined : "wide"}>
        <AppBar
          lead={<HowToButton variant="kit" />}
          action={
            <Link aria-label="Your account and projects" className="kit-icon-button" href="/client/plan#account">
              <UserRound aria-hidden="true" size={22} />
            </Link>
          }
          studio={studio}
        />
        {workspace.error ? (
          <div className="kit-banner" role="alert">
            <p className="kit-note" data-tone="danger">
              <CircleAlert aria-hidden="true" size={18} />
              <span>
                <strong>Your project is temporarily unavailable.</strong> {workspace.error}
              </span>
            </p>
            <button className="kit-button" data-size="compact" data-variant="secondary" onClick={workspace.retry} type="button">
              Retry
            </button>
          </div>
        ) : null}
        {kit ? (
          children
        ) : (
          <div
            className="ds-root kit-legacy"
            data-ds-theme="emerald"
            style={portalAccentStyle(brand?.primaryColor) as CSSProperties}
          >
            <main className="ds-content">{children}</main>
          </div>
        )}
        <TabBar active={clientTabFor(pathname)} tabs={clientTabs} />
      </div>
    </KitRoot>
  );
}

function ClientPortalLoadingShell() {
  return (
    <KitRoot>
      <div aria-live="polite" className="kit-screen">
        <AppBar title="Your project" />
        <main aria-label="Opening your project" className="kit-main">
          <p className="kit-body" role="status">
            <LoaderCircle aria-hidden="true" className="spin" size={18} /> Opening your secure project…
          </p>
        </main>
      </div>
    </KitRoot>
  );
}
