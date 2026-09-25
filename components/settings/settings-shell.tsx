"use client";

import Link from "next/link";
import type { ComponentType } from "react";
import { useEffect, useState } from "react";
import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Database,
  Forward,
  LayoutTemplate,
  Palette,
  Plug,
  Sparkles,
  Store,
  UserRoundCheck,
  UsersRound,
  Wand2,
} from "lucide-react";

import { CrewOfferSettings } from "@/components/crew/crew-offer-settings";
import { EmailTemplateDesigner } from "@/components/communications/email-template-designer";
import { LifecyclePackPanel } from "@/components/communications/lifecycle-pack-panel";
import { ConsultationAvailability } from "@/components/settings/consultation-availability";
import { InquiryForwardingSettings } from "@/components/crm/inquiry-forwarding-address";
import { DataControls } from "@/components/settings/data-controls";
import { EmailBranding } from "@/components/settings/email-branding";
import { SettingsDestinations } from "@/components/settings/settings-destinations";
import { StudioIdentitySettings } from "@/components/settings/studio-identity";

/**
 * Settings on a phone.
 *
 * The desktop page stacks seven full panels top to bottom — a single wall the
 * length of a forearm on a phone, with no way to see what is even in it. This
 * rebuilds the phone experience as a native settings hub: grouped rows you scan
 * in one screen, each drilling into a full-screen detail for one panel. The
 * panels themselves are reused unchanged; only the navigation is new. Desktop is
 * left exactly as it was.
 */

function useIsPhone() {
  // null until measured, so the first paint commits to neither layout — mounting
  // the desktop stack then throwing it away would double every panel's Firestore
  // subscription for a frame.
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

type SectionKey =
  | "identity"
  | "branding"
  | "availability"
  | "templates"
  | "drafts"
  | "forwarding"
  | "crewOffers"
  | "data";

const SECTION_COMPONENT: Record<SectionKey, ComponentType> = {
  identity: StudioIdentitySettings,
  branding: EmailBranding,
  availability: ConsultationAvailability,
  templates: EmailTemplateDesigner,
  drafts: LifecyclePackPanel,
  forwarding: InquiryForwardingSettings,
  crewOffers: CrewOfferSettings,
  data: DataControls,
};

type HubItem =
  | {
      kind: "section";
      key: SectionKey;
      icon: ComponentType<{ size?: number }>;
      title: string;
      subtitle: string;
    }
  | {
      kind: "link";
      href: string;
      icon: ComponentType<{ size?: number }>;
      title: string;
      subtitle: string;
    };

const GROUPS: Array<{ label: string; items: HubItem[] }> = [
  {
    label: "Your studio",
    items: [
      {
        kind: "section",
        key: "identity",
        icon: Store,
        title: "Studio details",
        subtitle: "Name, logo, and how clients see you",
      },
      {
        kind: "section",
        key: "branding",
        icon: Palette,
        title: "Email branding",
        subtitle: "Colours and sender name on client emails",
      },
      {
        kind: "section",
        key: "availability",
        icon: CalendarClock,
        title: "Consultation availability",
        subtitle: "When clients can book a call",
      },
    ],
  },
  {
    label: "Communications",
    items: [
      {
        kind: "section",
        key: "templates",
        icon: LayoutTemplate,
        title: "Email templates",
        subtitle: "Design the branded template",
      },
      {
        kind: "section",
        key: "drafts",
        icon: Sparkles,
        title: "Automatic drafts",
        subtitle: "Which lifecycle emails are drafted for you",
      },
      {
        kind: "section",
        key: "forwarding",
        icon: Forward,
        title: "Inquiry capture",
        subtitle: "Website form, inbox, or forward by hand",
      },
    ],
  },
  {
    label: "Crew",
    items: [
      {
        kind: "section",
        key: "crewOffers",
        icon: UserRoundCheck,
        title: "Crew offers",
        subtitle: "Whether booking sends the prepared offers, or you do",
      },
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
        subtitle: "Packages, agreement, details form, and hours",
      },
    ],
  },
  {
    label: "Data & privacy",
    items: [
      {
        kind: "section",
        key: "data",
        icon: Database,
        title: "Data & account",
        subtitle: "Export your data or request deletion",
      },
    ],
  },
];

const SECTION_TITLE = Object.fromEntries(
  GROUPS.flatMap((group) =>
    group.items
      .filter((item): item is Extract<HubItem, { kind: "section" }> => item.kind === "section")
      .map((item) => [item.key, item.title] as const),
  ),
) as Record<SectionKey, string>;

function DesktopSettings() {
  return (
    <div className="saas-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Your studio</p>
          <h1>Studio settings</h1>
          <p>
            How clients see your studio, what it connects to, and what you pay
            for.
          </p>
        </div>
      </header>
      <SettingsDestinations />
      {/* The studio's own identity, frozen at signup until now.
          See features/tenants/identity.ts. */}
      <StudioIdentitySettings />
      <EmailBranding />
      <EmailTemplateDesigner />
      <LifecyclePackPanel />
      {/* Absent from this stack until now, while being listed on the phone
          screen — so "Studio settings → Communications", one of the three
          routes c657cbb added to make the forwarding address findable, did
          not exist on desktop at all. Found by tests/settings-sections. */}
      <InquiryForwardingSettings />
      <ConsultationAvailability />
      {/* Desktop renders its own fixed stack rather than reading GROUPS, so a
          section added to GROUPS alone appears on phones and nowhere else —
          which is exactly what happened to this one. tests/settings-sections
          now asserts the two agree. */}
      <CrewOfferSettings />
      <DataControls />
    </div>
  );
}

function linkedSection(): SectionKey | null {
  if (typeof window === "undefined") return null;
  const section = new URLSearchParams(window.location.search).get("section");
  return section && section in SECTION_COMPONENT ? (section as SectionKey) : null;
}

export function SettingsShell() {
  const isPhone = useIsPhone();
  // `open` is only ever read on the phone branch; the desktop branch renders the
  // full stack regardless, so no effect is needed to reconcile it on resize.
  // `?section=forwarding` — the "capture every inquiry automatically" link on
  // Today and Leads lands on the panel itself, not the top of a long page.
  // Read from window rather than useSearchParams, which would need a Suspense
  // boundary around the whole settings page. `open` is only read on the phone
  // branch, which never renders on the server, so there is nothing to hydrate.
  const [open, setOpen] = useState<SectionKey | null>(linkedSection);

  // On a desk the panels above load their data after this runs and push the
  // target down, so one scroll lands on whatever grew into its place. Keep it
  // in view until the page stops moving (or ~3s), and hand over the moment
  // the person scrolls themselves.
  useEffect(() => {
    if (isPhone !== false || linkedSection() !== "forwarding") return;
    let stopped = false;
    const stop = () => {
      stopped = true;
    };
    const events = ["wheel", "touchstart", "keydown", "mousedown"] as const;
    events.forEach((name) => window.addEventListener(name, stop, { once: true, passive: true }));
    let lastTop: number | null = null;
    let steady = 0;
    const timer = window.setInterval(() => {
      const target = document.getElementById("inquiry-capture");
      if (stopped || !target) return;
      const top = Math.round(target.getBoundingClientRect().top);
      // Where it should sit: below the sticky header (the panel's scroll-margin).
      const want = parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
      // Instant, not the page's smooth default: a link should land, not glide
      // 3,000px — and a smooth scroll restarted every tick never settles (nor
      // runs at all in a background tab).
      if (Math.abs(top - want) > 2) target.scrollIntoView({ block: "start", behavior: "instant" });
      steady = lastTop === top ? steady + 1 : 0;
      lastTop = top;
      if (steady >= 3) stop();
    }, 250);
    const limit = window.setTimeout(stop, 3000);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(limit);
      events.forEach((name) => window.removeEventListener(name, stop));
    };
  }, [isPhone]);

  if (isPhone === null) {
    // First paint, before the viewport is measured: heading only, no panels.
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

  if (!isPhone) return <DesktopSettings />;

  const ActiveSection = open ? SECTION_COMPONENT[open] : null;

  return (
    <div className="settings-mobile">
      <header className="settings-mobile-head">
        <h1>Settings</h1>
        <p>How clients see your studio, what it connects to, and what you pay for.</p>
      </header>

      {GROUPS.map((group) => (
        <section className="settings-group" key={group.label}>
          <p className="settings-group-label">{group.label}</p>
          <div className="settings-group-card">
            {group.items.map((item) =>
              item.kind === "section" ? (
                <button
                  type="button"
                  className="settings-row"
                  key={item.key}
                  onClick={() => setOpen(item.key)}
                >
                  <span className="settings-row-icon">
                    <item.icon size={18} />
                  </span>
                  <span className="settings-row-text">
                    <strong>{item.title}</strong>
                    <small>{item.subtitle}</small>
                  </span>
                  <ChevronRight size={17} className="settings-row-chev" />
                </button>
              ) : (
                <Link className="settings-row" href={item.href} key={item.href}>
                  <span className="settings-row-icon">
                    <item.icon size={18} />
                  </span>
                  <span className="settings-row-text">
                    <strong>{item.title}</strong>
                    <small>{item.subtitle}</small>
                  </span>
                  <ChevronRight size={17} className="settings-row-chev" />
                </Link>
              ),
            )}
          </div>
        </section>
      ))}

      {ActiveSection && open ? (
        <div className="settings-detail" role="dialog" aria-modal="true">
          <header className="settings-detail-head">
            <button
              type="button"
              className="settings-back"
              onClick={() => setOpen(null)}
              aria-label="Back to settings"
            >
              <ChevronLeft size={18} aria-hidden />
            </button>
            <h2>{SECTION_TITLE[open]}</h2>
          </header>
          <div className="settings-detail-body">
            <ActiveSection />
          </div>
        </div>
      ) : null}
    </div>
  );
}
