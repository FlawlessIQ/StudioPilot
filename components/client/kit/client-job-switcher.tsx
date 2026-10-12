"use client";

import { useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Check, ChevronDown, CircleAlert, X } from "lucide-react";
import { useWorkspace } from "@/features/auth/workspace-context";
import { clientJobSwitcherItems } from "@/features/client/job-choice";
import { formatEventDate } from "@/lib/format/event-date";

/**
 * Which booking is open, and the others, under the studio's name.
 *
 * Priya Shah had two bookings with one studio — her wedding and her Sangeet —
 * and the portal showed one with no sign the other existed; the account area
 * held her name, email and Sign out (2026-10-12). A client with two or more
 * bookings now sees which is open at the top of every screen, and can open
 * another from there. A client with one sees nothing new.
 *
 * One compact row on a phone; the list opens beneath it. The choice is
 * remembered (features/auth/workspace-context.tsx, selectProject).
 */
export function ClientJobSwitcher() {
  const workspace = useWorkspace();
  const router = useRouter();
  const pathname = usePathname();
  const menu = useRef<HTMLDetailsElement>(null);
  const items = clientJobSwitcherItems(workspace.clientProjects, workspace.projectId);
  if (!items) return null;
  const current = items.find((item) => item.active);
  const choose = (projectId: string) => {
    if (menu.current) menu.current.open = false;
    if (projectId === workspace.projectId) return;
    // A page about one booking's record (an agreement, a form) starts over
    // from Home for the next, rather than showing a page it may not have.
    void workspace.selectProject(projectId).then(() => {
      if (pathname !== "/client") router.push("/client");
    });
  };
  return (
    <nav aria-label="Your bookings" className="kit-job-switcher">
      <details className="kit-job-switcher-menu" ref={menu}>
        <summary>
          <span className="kit-job-switcher-current">
            <span className="kit-job-switcher-name">{current?.name ?? workspace.projectName}</span>
            <span className="kit-job-switcher-meta">
              {current?.eventDate ? `${formatEventDate(current.eventDate)} · ` : ""}
              {items.length} bookings with {workspace.tenantBrand?.brandName ?? workspace.tenantName}
            </span>
          </span>
          <span className="kit-job-switcher-action">
            Switch <ChevronDown aria-hidden="true" size={16} />
          </span>
        </summary>
        <ul className="kit-list kit-job-switcher-list">
          {items.map((item) => (
            <li key={item.id}>
              <button
                aria-current={item.active ? "true" : undefined}
                className="kit-row"
                onClick={() => choose(item.id)}
                type="button"
              >
                <span className="kit-row-text">
                  <span className="kit-row-title">{item.name}</span>
                  <span className="kit-row-subtitle">
                    {item.eventDate ? formatEventDate(item.eventDate) : "Date to confirm"}
                  </span>
                </span>
                {item.active ? (
                  <span className="kit-row-trailing">
                    <Check aria-hidden="true" size={18} /> Open
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </details>
    </nav>
  );
}

/** Said once when a link's booking isn't on this account and another opened. */
export function ClientJobNotice() {
  const workspace = useWorkspace();
  if (!workspace.clientProjectNotice) return null;
  return (
    <div className="kit-banner" role="status">
      <p className="kit-note">
        <CircleAlert aria-hidden="true" size={18} />
        <span>{workspace.clientProjectNotice}</span>
      </p>
      <button
        className="kit-button"
        data-size="compact"
        data-variant="secondary"
        onClick={workspace.dismissClientProjectNotice}
        type="button"
      >
        <X aria-hidden="true" size={16} /> Dismiss
      </button>
    </div>
  );
}
