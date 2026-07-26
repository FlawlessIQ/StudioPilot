import type { LucideIcon } from "lucide-react";
import {
  CalendarDays,
  CircleDollarSign,
  ClipboardCheck,
  FileSignature,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import type { ProjectState } from "@/features/projects/schema";

export type DemoProject = {
  id: string;
  client: string;
  event: string;
  date: string;
  state: ProjectState;
  readiness: number;
  blocker: string;
  owner: string;
  tone: "ready" | "risk" | "progress";
};

export const demoProjects: readonly DemoProject[] = [
  {
    id: "PRJ-2048",
    client: "Maya & Theo Johnson",
    event: "Wedding · The Foundry",
    date: "Aug 15",
    state: "PLANNING",
    readiness: 72,
    blocker: "Final schedule approval",
    owner: "Client",
    tone: "risk",
  },
  {
    id: "PRJ-2051",
    client: "Sofia & Miles Carter",
    event: "Wedding · Cedar Lakes",
    date: "Aug 22",
    state: "READY",
    readiness: 100,
    blocker: "No blockers",
    owner: "Complete",
    tone: "ready",
  },
  {
    id: "PRJ-2064",
    client: "Northstar Annual Summit",
    event: "Corporate · Pier 59",
    date: "Sep 04",
    state: "BOOKED",
    readiness: 46,
    blocker: "Shot list and PO",
    owner: "Coordinator",
    tone: "progress",
  },
  {
    id: "PRJ-2072",
    client: "Hudson Valley Athletics",
    event: "Sports · Fall Media Day",
    date: "Sep 12",
    state: "CONTRACT_PENDING",
    readiness: 24,
    blocker: "Organization agreement",
    owner: "Client",
    tone: "risk",
  },
];

export const todayItems: readonly {
  label: string;
  detail: string;
  time: string;
  icon: LucideIcon;
  tone: string;
}[] = [
  {
    label: "Consultation",
    detail: "Lena & Chris · Zoom",
    time: "10:30 AM",
    icon: CalendarDays,
    tone: "violet",
  },
  {
    label: "Retainer received",
    detail: "Priya & Jordan · $1,850",
    time: "8 min ago",
    icon: CircleDollarSign,
    tone: "green",
  },
  {
    label: "Schedule review due",
    detail: "Johnson wedding · v3",
    time: "Today",
    icon: ClipboardCheck,
    tone: "amber",
  },
];

export const riskItems: readonly {
  label: string;
  detail: string;
  owner: string;
  icon: LucideIcon;
}[] = [
  {
    label: "2 unsigned contracts",
    detail: "Nearest event in 27 days",
    owner: "Client",
    icon: FileSignature,
  },
  {
    label: "1 COI needs correction",
    detail: "Additional insured wording",
    owner: "Studio",
    icon: ShieldCheck,
  },
  {
    label: "3 crew acknowledgements",
    detail: "Published schedule v4",
    owner: "Crew",
    icon: UserCheck,
  },
];
