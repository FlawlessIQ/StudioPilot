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
  { label: "Home", icon: Home },
  { label: "Project details", icon: CalendarDays },
  { label: "Contract", icon: FileText },
  { label: "Payments", icon: CreditCard },
  { label: "Questionnaires", icon: ClipboardList },
  { label: "Schedule", icon: CalendarDays },
  { label: "Documents", icon: FolderOpen },
  { label: "Messages", icon: MessageCircle },
  { label: "Delivery", icon: Images },
  { label: "Reviews", icon: Star },
] as const;

export function PortalShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="portal-frame">
      <aside className="portal-sidebar" id="portal-navigation">
        <Link href="/client"><Logo /></Link>
        <div className="portal-project">
          <small>Your project</small>
          <strong>Maya &amp; Theo</strong>
          <span>August 15, 2026</span>
        </div>
        <nav aria-label="Client portal navigation">
          {portalNav.map((item, index) => {
            const Icon = item.icon;
            return (
              <Link
                href={index === 0 ? "/client" : `/client#${item.label.toLowerCase().replace(" ", "-")}`}
                className={index === 0 ? "portal-nav-active" : ""}
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
