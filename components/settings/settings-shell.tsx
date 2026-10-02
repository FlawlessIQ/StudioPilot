"use client";

import { CoiSettings } from "@/components/settings/coi-settings";
import Link from "next/link";
import type { ComponentType } from "react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  CalendarClock,
  Shapes,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Database,
  Forward,
  LayoutTemplate,
  MessageSquareReply,
  Palette,
  Plug,
  Sparkles,
  Store,
  ShieldCheck,
  UserRoundCheck,
  UsersRound,
  Wand2,
  CalendarRange,
} from "lucide-react";

import { CrewOfferSettings } from "@/components/crew/crew-offer-settings";
import { PlanningTimelineSettings } from "@/components/planning/planning-timeline-settings";
import { JobTypesSettings } from "@/components/job-kinds/job-types-settings";
import { EmailTemplateDesigner } from "@/components/communications/email-template-designer";
import { LifecyclePackPanel } from "@/components/communications/lifecycle-pack-panel";
import { ConsultationAvailability } from "@/components/settings/consultation-availability";
import { InquiryForwardingSettings } from "@/components/crm/inquiry-forwarding-address";
import { DataControls } from "@/components/settings/data-controls";
import { EmailBranding } from "@/components/settings/email-branding";
import { FirstReplySettings } from "@/components/settings/first-reply-settings";
import { StudioIdentitySettings } from "@/components/settings/studio-identity";
import { useSetupState } from "@/components/setup/use-setup-state";
import { OutsideStepsInFlight } from "@/components/outside-steps/outside-steps-in-flight";
import {
  SETTINGS_SECTIONS,
  legacySettingsTarget,
  settingsSectionHref,
  type SettingsSectionKey,
} from "@/features/settings/sections";

/**
 * Studio settings: a hub of quick links, and a page per section.
 *
 * It was one page stacking eight panels, so a section near the bottom —
 * Inquiry capture sat 3,600px down — was found by scrolling past everything
 * above it. Now the hub is one screen of cards grouped the way the phone
 * already grouped them, and each opens its own page
 * (/studio/settings/<slug>, see features/settings/sections.ts). The panels
 * themselves are unchanged.
 */

function useIsPhone() {
  // null until measured, so the first paint commits to neither layout.
  const [phone, setPhone] = useState<boolean | null>(null);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 760px)");
    const sync = () => setPhone(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return phone;
}

type SectionKey = SettingsSectionKey;

const SECTION_COMPONENT: Record<SectionKey, ComponentType> = {
  identity: StudioIdentitySettings,
  branding: EmailBranding,
  availability: ConsultationAvailability,
  jobTypes: JobTypesSettings,
  templates: EmailTemplateDesigner,
  firstReply: FirstReplySettings,
  drafts: LifecyclePackPanel,
  forwarding: InquiryForwardingSettings,
  planning: PlanningTimelineSettings,
  crewOffers: CrewOfferSettings,
  insurance: CoiSettings,
  data: DataControls,
};

type HubItem =
  | { kind: "section"; key: SectionKey; icon: ComponentType<{ size?: number }> }
  | {
      kind: "link";
      href: string;
      icon: ComponentType<{ size?: number }>;
      title: string;
      subtitle: string;
    };

const GROUPS: Array<{ label: string; note?: string; items: HubItem[] }> = [
  {
    label: "Your studio",
    items: [
      { kind: "section", key: "identity", icon: Store },
      { kind: "section", key: "branding", icon: Palette },
      { kind: "section", key: "availability", icon: CalendarClock },
      { kind: "section", key: "jobTypes", icon: Shapes },
    ],
  },
  {
    label: "Communications",
    // A new inquiry gets two emails and studios couldn't tell which setting
    // changed which (GR Productions, 2026-10-01).
    note: "A new inquiry gets two emails. The automatic \u201cwe got your inquiry\u201d one goes straight away \u2014 change its words under Email templates (Inquiry Acknowledgement). Your personal first reply is drafted for you to approve, and follows what you write under How your first reply should go.",
    items: [
      { kind: "section", key: "forwarding", icon: Forward },
      { kind: "section", key: "templates", icon: LayoutTemplate },
      { kind: "section", key: "firstReply", icon: MessageSquareReply },
      { kind: "section", key: "drafts", icon: Sparkles },
    ],
  },
  {
    label: "Planning",
    items: [{ kind: "section", key: "planning", icon: CalendarRange }],
  },
  {
    label: "Crew and insurance",
    items: [
      { kind: "section", key: "crewOffers", icon: UserRoundCheck },
      { kind: "section", key: "insurance", icon: ShieldCheck },
    ],
  },
  {
    label: "Workspace",
    items: [
      {
        kind: "link",
        href: "/studio/integrations",
        icon: Plug,
        title: "Integrations",
        subtitle: "Calendar, meetings, files, contracts, accounting",
      },
      {
        kind: "link",
        href: "/studio/subscription",
        icon: CreditCard,
        title: "Plan & billing",
        subtitle: "Your plan, what's included, and invoices",
      },
      {
        kind: "link",
        href: "/studio/team",
        icon: UsersRound,
        title: "Team",
        subtitle: "Who can see and do what in this workspace",
      },
      {
        kind: "link",
        href: "/studio/setup",
        icon: Wand2,
        title: "Finish setting up",
        subtitle: "Inquiries, hours, packages, agreement, details form and insurance",
      },
    ],
  },
  {
    label: "Data & privacy",
    items: [{ kind: "section", key: "data", icon: Database }],
  },
];

/** Where a hub item goes and what it says, whichever kind it is. */
function resolve(item: HubItem, setupComplete = false) {
  // "Finish setting up" on a studio that has: it reads as a nag that's wrong.
  if (item.kind === "link" && item.href === "/studio/setup" && setupComplete)
    return { ...item, title: "Review setup", subtitle: "Everything's answered — change any of it" };
  if (item.kind === "link") return item;
  const section = SETTINGS_SECTIONS.find((entry) => entry.key === item.key)!;
  return {
    href: settingsSectionHref(item.key),
    icon: item.icon,
    title: section.title,
    subtitle: section.subtitle,
  };
}

export function SettingsShell() {
  const isPhone = useIsPhone();
  const { complete: setupComplete } = useSetupState();
  const router = useRouter();

  // Links written before each section had a page — `?section=forwarding`
  // from Today and Leads, `#consultation-availability` from setup gaps —
  // still arrive here. Send them on to the page they meant.
  useEffect(() => {
    const target = legacySettingsTarget(window.location.search, window.location.hash);
    if (target) router.replace(target);
  }, [router]);

  if (isPhone === null) {
    // First paint, before the viewport is measured: heading only.
    return (
      <div className="saas-page">
        <header className="page-heading">
          <div>
            <p className="eyebrow">Your studio</p>
            <h1>Studio settings</h1>
          </div>
        </header>
      </div>
    );
  }

  if (!isPhone)
    return (
      <div className="saas-page settings-hub">
        <header className="page-heading">
          <div>
            <p className="eyebrow">Your studio</p>
            <h1>Studio settings</h1>
            <p>How clients see your studio, what it connects to, and what you pay for.</p>
          </div>
        </header>
        <OutsideStepsInFlight />
        {GROUPS.map((group) => (
          <section aria-label={group.label} className="settings-hub-group" key={group.label}>
            {/* A <p>, as on the phone: the studio's h2 rule sets the serif display
                face, which made these small caps labels read as headings. The
                section's aria-label already names the group. */}
            <p className="settings-group-label">{group.label}</p>
            {group.note ? <p className="settings-group-note">{group.note}</p> : null}
            <div className="settings-destinations">
              {group.items.map((item) => {
                const { href, icon: Icon, title, subtitle } = resolve(item, setupComplete);
                return (
                  <Link href={href} key={href}>
                    <span className="settings-destination-icon">
                      <Icon size={17} />
                    </span>
                    <span>
                      <strong>{title}</strong>
                      <small>{subtitle}</small>
                    </span>
                    <ArrowRight size={15} />
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    );

  return (
    <div className="settings-mobile">
      <header className="settings-mobile-head">
        <h1>Settings</h1>
        <p>How clients see your studio, what it connects to, and what you pay for.</p>
      </header>
      <OutsideStepsInFlight />

      {GROUPS.map((group) => (
        <section className="settings-group" key={group.label}>
          <p className="settings-group-label">{group.label}</p>
          {group.note ? <p className="settings-group-note">{group.note}</p> : null}
          <div className="settings-group-card">
            {group.items.map((item) => {
              const { href, icon: Icon, title, subtitle } = resolve(item, setupComplete);
              return (
                <Link className="settings-row" href={href} key={href}>
                  <span className="settings-row-icon">
                    <Icon size={18} />
                  </span>
                  <span className="settings-row-text">
                    <strong>{title}</strong>
                    <small>{subtitle}</small>
                  </span>
                  <ChevronRight size={17} className="settings-row-chev" />
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

/** One section on its own page, with the way back to the hub. */
export function SettingsSectionPage({
  sectionKey,
  backToSetup = false,
}: {
  sectionKey: SectionKey;
  /** Opened from a setup question: the way back is setup, not the hub. */
  backToSetup?: boolean;
}) {
  const Section = SECTION_COMPONENT[sectionKey];
  return (
    <div className="saas-page settings-section-page">
      <Link className="settings-section-back" href={backToSetup ? "/studio/setup" : "/studio/settings"}>
        <ChevronLeft aria-hidden="true" size={16} /> {backToSetup ? "Back to setup" : "Studio settings"}
      </Link>
      <Section />
    </div>
  );
}
