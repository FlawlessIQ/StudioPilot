"use client";

import Link from "next/link";
import {
  ArrowRight,
  CreditCard,
  ExternalLink,
  PlugZap,
  Settings,
  UsersRound,
} from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { TenantInquiryLink } from "@/components/crm/tenant-inquiry-link";
import { useWorkspace } from "@/features/auth/workspace-context";

const settings = [
  {
    title: "Studio setup",
    description: "Connect the calendar, meeting, file, accounting, and signature services your team uses.",
    href: "/studio/integrations",
    icon: PlugZap,
    roles: ["studio_owner", "studio_admin"],
  },
  {
    title: "Team access",
    description: "Invite staff and give each person only the access they need.",
    href: "/studio/team",
    icon: UsersRound,
    roles: ["studio_owner"],
  },
  {
    title: "Plan & billing",
    description: "Review plan limits, AI usage, and Stripe billing.",
    href: "/studio/subscription",
    icon: CreditCard,
    roles: ["studio_owner"],
  },
  {
    title: "Brand, email & account",
    description: "Manage email branding and templates, export data, or review account controls.",
    href: "/studio/settings",
    icon: Settings,
    roles: ["studio_owner"],
  },
];

export default function SetupPage() {
  return (
    <AppShell active="Studio setup">
      <SetupContent />
    </AppShell>
  );
}

function SetupContent() {
  const workspace = useWorkspace();
  const availableSettings = settings.filter((setting) =>
    setting.roles.includes(workspace.role ?? ""),
  );
  return (
    <div className="hub-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Studio administration</p>
          <h1>Studio setup</h1>
          <p>Manage the services, people, and account settings behind your workspace.</p>
        </div>
      </header>
      <section className="setup-inquiry-card">
        <span><ExternalLink size={20} /></span>
        <div>
          <h2>Client inquiry form</h2>
          <p>Preview the tenant-specific form clients use to contact your studio.</p>
        </div>
        <TenantInquiryLink />
      </section>
      <section className="hub-grid">
        {availableSettings.map((setting) => {
          const Icon = setting.icon;
          return (
            <Link href={setting.href} key={setting.title}>
              <span><Icon size={20} /></span>
              <div><h2>{setting.title}</h2><p>{setting.description}</p></div>
              <ArrowRight size={17} />
            </Link>
          );
        })}
      </section>
    </div>
  );
}
