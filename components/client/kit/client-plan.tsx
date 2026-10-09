"use client";

import {
  CalendarCheck,
  CalendarDays,
  CircleDollarSign,
  ClipboardList,
  FileSignature,
  Images,
  ListChecks,
  Package,
  Star,
  UserRound,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { List, Main, PoweredBy, Row } from "@/components/kit/kit";
import { SignOutButton } from "@/features/auth/auth-boundary";
import { useWorkspace } from "@/features/auth/workspace-context";
import { clientAreaItems } from "@/features/client/portal-navigation";
import { tradeProfile, tradeVocab } from "@/features/trades/trades";
import { useProject } from "@/components/client/live-client-views";

const ICONS = {
  CalendarCheck,
  Package,
  ClipboardList,
  FileSignature,
  ListChecks,
  CalendarDays,
  Images,
  Star,
} as const;

const BOOKING = new Set(["/client/package", "/client/proposal", "/client/contract"]);
const AFTER = new Set(["/client/delivery", "/client/reviews"]);

/**
 * Everything by stage, in one list: the couple's Plan tab (M3 of
 * docs/mobile-first-client-crew-plan-2026-09-28.md). It replaces the
 * sidebar and the "More" drawer. What appears is what the server says exists
 * for this project (`navigation`), as before; account and project switching
 * sit at the end.
 */
export function ClientPlan() {
  const workspace = useWorkspace();
  const router = useRouter();
  // The same project Home reads (the workspace's copy when live).
  const project = useProject().value;
  const items = clientAreaItems(
    project?.navigation,
    tradeVocab(workspace.tenantTrade).proposal,
    tradeProfile(workspace.tenantTrade).delivery,
  ).map((item) => ({
    ...item,
    Icon: ICONS[item.icon],
  }));
  const next = project?.nextClientAction;
  const subtitle = (href: string) =>
    next && next.href === href && next.responsibility === "client" ? "Your next step" : undefined;
  const booking = items.filter((item) => BOOKING.has(item.href));
  const planning = items.filter((item) => !BOOKING.has(item.href) && !AFTER.has(item.href));
  const after = items.filter((item) => AFTER.has(item.href));

  return (
    <Main label="Your plan">
      <div className="kit-stack-tight">
        <p className="kit-eyebrow">{project?.name ?? workspace.projectName}</p>
        <h1 className="kit-title">Your plan</h1>
      </div>

      <section className="kit-stack-tight" aria-label="Booking">
        <h2 className="kit-subsection">Booking</h2>
        <List>
          {booking.map(({ href, label, Icon }) => (
            <Row href={href} icon={Icon} key={href} subtitle={subtitle(href)} title={label} />
          ))}
          <Row href="/client/payments" icon={CircleDollarSign} subtitle={subtitle("/client/payments")} title="Payments" />
        </List>
      </section>

      {planning.length ? (
        <section className="kit-stack-tight" aria-label="Planning">
          <h2 className="kit-subsection">Planning</h2>
          <List>
            {planning.map(({ href, label, Icon }) => (
              <Row href={href} icon={Icon} key={href} subtitle={subtitle(href)} title={label} />
            ))}
          </List>
        </section>
      ) : null}

      {after.length ? (
        <section className="kit-stack-tight" aria-label="After the day">
          <h2 className="kit-subsection">After the day</h2>
          <List>
            {after.map(({ href, label, Icon }) => (
              <Row href={href} icon={Icon} key={href} subtitle={subtitle(href)} title={label} />
            ))}
          </List>
        </section>
      ) : null}

      <section className="kit-stack-tight" id="account" aria-label="Account">
        <h2 className="kit-subsection">Account</h2>
        <List>
          <Row icon={UserRound} subtitle={workspace.userEmail || undefined} title={workspace.userName} trailing={null} />
          {workspace.clientProjects.length > 1
            ? workspace.clientProjects
                .filter((project) => project.id !== workspace.projectId)
                .map((project) => (
                  <li key={project.id}>
                    <button
                      className="kit-row"
                      onClick={() =>
                        void workspace.selectProject(project.id).then(() => router.push("/client"))
                      }
                      style={{ width: "100%", border: 0, background: "transparent", textAlign: "left" }}
                      type="button"
                    >
                      <span className="kit-row-text">
                        <span className="kit-row-title">Switch to {project.name}</span>
                        {project.eventDate ? <span className="kit-row-subtitle">{project.eventDate}</span> : null}
                      </span>
                    </button>
                  </li>
                ))
            : null}
        </List>
        <SignOutButton className="kit-button kit-signout" />
      </section>
      <PoweredBy />
    </Main>
  );
}
