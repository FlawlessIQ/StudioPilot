import Link from "next/link";
import {
  CalendarDays,
  ChevronRight,
  ClipboardList,
  CreditCard,
  FileText,
  FolderOpen,
  Home,
  Images,
  Menu,
  MessageCircle,
  Star,
  UserRound,
} from "lucide-react";
import { Logo } from "@/components/brand/logo";

const portalNav = [
  { label: "Home", icon: Home, href: "/client" },
  { label: "Project details", icon: CalendarDays, href: "/client#project-details" },
  { label: "Package", icon: FileText, href: "/client/package" },
  { label: "Contract", icon: FileText, href: "/client/contract" },
  { label: "Payments", icon: CreditCard, href: "/client/payments" },
  { label: "Questionnaires", icon: ClipboardList, href: "/client/questionnaire" },
  { label: "Schedule", icon: CalendarDays, href: "/client/schedule" },
  { label: "Documents", icon: FolderOpen, href: "/client#documents" },
  { label: "Messages", icon: MessageCircle, href: "/client#messages" },
  { label: "Delivery", icon: Images, href: "/client/delivery" },
  { label: "Reviews", icon: Star, href: "/client/reviews" },
] as const;

export function PortalShell({ children, active = "Home", projectName = "Maya & Theo", projectDate = "August 15, 2026" }: { children: React.ReactNode; active?: string; projectName?: string; projectDate?: string }) {
  return (
    <div className="portal-frame">
      <aside className="portal-sidebar" id="portal-navigation">
        <Link href="/client"><Logo /></Link>
        <div className="portal-project">
          <small>Your project</small>
          <strong>{projectName}</strong>
          <span>{projectDate}</span>
        </div>
        <nav aria-label="Client portal navigation">
          {portalNav.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                href={item.href}
                className={item.label === active ? "portal-nav-active" : ""}
                key={item.label}
              >
                <Icon size={17} />
                <span>{item.label}</span>
                {item.label === "Questionnaires" ? <i>1</i> : null}
              </Link>
            );
          })}
        </nav>
        <div className="portal-profile">
          <span className="avatar avatar-sand"><UserRound size={16} /></span>
          <span><strong>Maya Johnson</strong><small>Client</small></span>
          <ChevronRight size={15} />
        </div>
      </aside>
      <main className="portal-content">
        <header>
          <a className="mobile-menu" href="#portal-navigation" aria-label="Open client navigation">
            <Menu size={20} />
          </a>
          <span>Alder &amp; Muse Photography</span>
          <Link href="/auth/login">Sign out</Link>
        </header>
        {children}
      </main>
    </div>
  );
}
