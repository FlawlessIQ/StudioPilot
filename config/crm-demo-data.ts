import type { ProjectState } from "@/features/projects/schema";

export const crmLeads = [
  {
    id: "LD-1087",
    name: "Lena & Chris",
    event: "Wedding",
    date: "Oct 3, 2026",
    venue: "Prospect Park Boathouse",
    source: "Venue referral",
    status: "New",
    assigned: "Reese Morgan",
    age: "18 min",
    missing: 1,
  },
  {
    id: "LD-1082",
    name: "Hearthwell Brands",
    event: "Corporate",
    date: "Sep 28, 2026",
    venue: "Studio 525",
    source: "Google",
    status: "Consultation",
    assigned: "Conor Lawless",
    age: "Yesterday",
    missing: 0,
  },
  {
    id: "LD-1079",
    name: "Noah & Elise",
    event: "Wedding",
    date: "May 22, 2027",
    venue: "Venue not selected",
    source: "Instagram",
    status: "Reviewing",
    assigned: "Reese Morgan",
    age: "2 days",
    missing: 3,
  },
] as const;

export const crmClients = [
  {
    id: "CT-401",
    initials: "MJ",
    name: "Maya Johnson",
    email: "maya.johnson@example.test",
    project: "Johnson wedding",
    portal: "Active",
    lastContact: "Schedule comment · 8 min ago",
  },
  {
    id: "CT-406",
    initials: "SC",
    name: "Sofia Carter",
    email: "sofia.carter@example.test",
    project: "Carter wedding",
    portal: "Active",
    lastContact: "Questionnaire submitted · Yesterday",
  },
  {
    id: "CT-419",
    initials: "EG",
    name: "Ellis Grant",
    email: "ellis.grant@northstar.example.test",
    project: "Northstar Annual Summit",
    portal: "Invited",
    lastContact: "Portal invitation · Jul 24",
  },
] as const;

export const crmPackages = [
  {
    id: "PKG-SIGNATURE",
    name: "The Signature Collection",
    event: "Wedding",
    price: "$6,800",
    coverage: "8 hours",
    photographers: 2,
    version: 4,
    status: "Active",
    addOns: 5,
  },
  {
    id: "PKG-ESSENTIAL",
    name: "The Essential Collection",
    event: "Wedding",
    price: "$4,400",
    coverage: "6 hours",
    photographers: 1,
    version: 2,
    status: "Active",
    addOns: 4,
  },
  {
    id: "PKG-CORPORATE-HALF",
    name: "Corporate Half Day",
    event: "Corporate",
    price: "$3,200",
    coverage: "4 hours",
    photographers: 1,
    version: 1,
    status: "Draft",
    addOns: 3,
  },
] as const;

export type CrmProject = {
  id: string;
  name: string;
  event: string;
  date: string;
  venue: string;
  state: ProjectState;
  readiness: number;
  nextAction: string;
  owner: string;
};

export const crmProjects: readonly CrmProject[] = [
  {
    id: "PRJ-2048",
    name: "Maya & Theo Johnson",
    event: "Wedding",
    date: "Aug 15, 2026",
    venue: "The Foundry",
    state: "PLANNING",
    readiness: 72,
    nextAction: "Client to approve schedule",
    owner: "Reese Morgan",
  },
  {
    id: "PRJ-2051",
    name: "Sofia & Miles Carter",
    event: "Wedding",
    date: "Aug 22, 2026",
    venue: "Cedar Lakes Estate",
    state: "READY",
    readiness: 100,
    nextAction: "Event-day briefing",
    owner: "Conor Lawless",
  },
  {
    id: "PRJ-2064",
    name: "Northstar Annual Summit",
    event: "Corporate",
    date: "Sep 4, 2026",
    venue: "Pier 59",
    state: "BOOKED",
    readiness: 46,
    nextAction: "Request final shot list",
    owner: "Reese Morgan",
  },
  {
    id: "PRJ-2072",
    name: "Hudson Valley Athletics",
    event: "Sports",
    date: "Sep 12, 2026",
    venue: "Dutchess Stadium",
    state: "CONTRACT_PENDING",
    readiness: 24,
    nextAction: "Organization agreement",
    owner: "Conor Lawless",
  },
];
