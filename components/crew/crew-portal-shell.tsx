"use client";

import { createContext, useContext, useEffect } from "react";
import { usePathname } from "next/navigation";
import { BriefcaseBusiness, CalendarDays, CircleAlert, Home, LoaderCircle, UserRound } from "lucide-react";
import { AuthBoundary } from "@/features/auth/auth-boundary";
import { useWorkspace, WorkspaceProvider } from "@/features/auth/workspace-context";
import { AppBar, KitRoot, TabBar, type Studio, type Tab } from "@/components/kit/kit";
import { HowToButton } from "@/components/help/how-to";

/**
 * The crew's four tabs (decided 2026-09-28; M6 of
 * docs/mobile-first-client-crew-plan-2026-09-28.md). Crew live on their
 * phones at venues. The sidebar, the drawer and "Schedule & prep" are gone:
 * a job's prep, day sheet and closeout all open from the job itself.
 */
export const crewTabs: readonly Tab[] = [
  { label: "Today", href: "/crew", icon: Home },
  { label: "Jobs", href: "/crew/jobs", icon: BriefcaseBusiness },
  { label: "Calendar", href: "/crew/availability", icon: CalendarDays },
  { label: "Me", href: "/crew/account", icon: UserRound },
];

/**
 * What each page is called, and which tab it lives under. Two questions, two
 * answers: several routes share a tab, and no two should share a name. The
 * name titles the browser tab; each screen carries its own heading.
 */
export const crewPageTitles: Record<string, string> = {
  "": "Today",
  accepted: "Jobs",
  account: "Me",
  availability: "Calendar",
  closeout: "Hours and expenses",
  documents: "Documents",
  "event-day": "Day sheet",
  jobs: "Jobs",
  pending: "Offer",
  prep: "Job",
  profile: "Me",
  requirements: "Checklist",
  schedule: "Day sheet",
};

export const crewRouteLabels: Record<string, string> = {
  "": "Today",
  accepted: "Jobs",
  account: "Me",
  availability: "Calendar",
  closeout: "Jobs",
  documents: "Jobs",
  "event-day": "Jobs",
  jobs: "Jobs",
  pending: "Jobs",
  prep: "Jobs",
  profile: "Me",
  requirements: "Jobs",
  schedule: "Jobs",
};

const CrewShellContext = createContext(false);

export function CrewPortalShell({ children }: { children: React.ReactNode }) {
  // The layout mounts this once; a nested mount returns its children.
  const shellMounted = useContext(CrewShellContext);
  if (shellMounted) return <>{children}</>;
  return (
    <CrewShellContext.Provider value>
      <WorkspaceProvider area="crew">
        <AuthBoundary area="crew">
          <CrewShell>{children}</CrewShell>
        </AuthBoundary>
      </WorkspaceProvider>
    </CrewShellContext.Provider>
  );
}

function CrewShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const workspace = useWorkspace();
  const segment = pathname.split("/").filter(Boolean)[1] ?? "";
  const brand = workspace.tenantBrand;
  // The studio's brand leads, credited to StudioCue once at the foot of each
  // screen (M1).
  const studio: Studio = {
    name: brand?.brandName ?? workspace.tenantName,
    color: brand?.primaryColor ?? null,
    logoUrl: brand?.logoUrl ?? null,
  };
  const pageTitle = crewPageTitles[segment] ?? "Your work";

  useEffect(() => {
    document.title = `${pageTitle} · Your assignments`;
  }, [pageTitle]);

  if (workspace.loading)
    return (
      <KitRoot>
        <div aria-live="polite" className="kit-screen">
          <AppBar title="Your work" />
          <main aria-label="Opening your work" className="kit-main">
            <p className="kit-body" role="status">
              <LoaderCircle aria-hidden="true" className="spin" size={18} /> Opening your work…
            </p>
          </main>
        </div>
      </KitRoot>
    );

  return (
    <KitRoot studio={studio}>
      <div className="kit-screen">
        <AppBar lead={<HowToButton variant="kit" />} studio={studio} />
        {workspace.error ? (
          <div className="kit-banner" role="alert">
            <p className="kit-note" data-tone="danger">
              <CircleAlert aria-hidden="true" size={18} />
              <span>
                <strong>Your work is temporarily unavailable.</strong> {workspace.error}
              </span>
            </p>
            <button className="kit-button" data-size="compact" data-variant="secondary" onClick={workspace.retry} type="button">
              Retry
            </button>
          </div>
        ) : null}
        {children}
        <TabBar active={crewRouteLabels[segment] ?? "Today"} tabs={crewTabs} />
      </div>
    </KitRoot>
  );
}
