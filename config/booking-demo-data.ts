export const consultations = [
  { id: "CON-104", project: "Priya & Jordan", client: "Priya Shah", date: "Jul 27", time: "2:00 PM", mode: "Zoom", status: "Scheduled", owner: "Reese Morgan" },
  { id: "CON-107", project: "Hudson Valley Fall Media Day", client: "Alex Brooks", date: "Jul 28", time: "10:30 AM", mode: "Phone", status: "Scheduled", owner: "Conor Lawless" },
  { id: "CON-098", project: "Lena & Chris", client: "Lena Ortiz", date: "Jul 24", time: "4:00 PM", mode: "In person", status: "Completed", owner: "Conor Lawless" },
] as const;

export const proposals = [
  { id: "PROP-204", project: "Priya & Jordan", package: "Signature Collection", version: 3, total: "$7,640", expires: "Jul 30", status: "Viewed", updated: "18 min ago" },
  { id: "PROP-201", project: "Hudson Valley Fall Media Day", package: "Organization Media Day", version: 1, total: "$4,800", expires: "Aug 2", status: "Sent", updated: "Yesterday" },
  { id: "PROP-196", project: "Northstar Annual Summit", package: "Corporate Full Day", version: 2, total: "$8,950", expires: "Accepted", status: "Accepted", updated: "Jul 21" },
] as const;

export const contracts = [
  { id: "CTR-882", project: "Priya & Jordan", envelope: "6f3…a81", signers: "1 of 2", status: "Partially signed", updated: "8 min ago" },
  { id: "CTR-876", project: "Northstar Annual Summit", envelope: "7d1…c22", signers: "2 of 2", status: "Completed", updated: "Jul 22" },
  { id: "CTR-871", project: "Hudson Valley Fall Media Day", envelope: "4b8…19e", signers: "0 of 2", status: "Delivered", updated: "Yesterday" },
] as const;

export const invoices = [
  { id: "INV-941", project: "Priya & Jordan", kind: "Retainer", amount: "$1,910", balance: "$1,910", due: "Jul 30", status: "Sent", synced: "2 min ago" },
  { id: "INV-936", project: "Northstar Annual Summit", kind: "Retainer", amount: "$2,238", balance: "$0", due: "Jul 22", status: "Paid", synced: "5 min ago" },
  { id: "INV-918", project: "Maya & Theo Johnson", kind: "Final", amount: "$5,730", balance: "$0", due: "Aug 1", status: "Paid", synced: "12 min ago" },
] as const;

export const bookingProjects = [
  { id: "PRJ-2037", project: "Priya & Jordan", score: 60, state: "RETAINER PENDING", checks: ["Contract complete", "Invoice created", "Retainer unpaid", "Date available", "Contacts complete"], blockers: 1 },
  { id: "PRJ-2068", project: "Hudson Valley Fall Media Day", score: 40, state: "CONTRACT PENDING", checks: ["Contract incomplete", "Invoice not created", "Date available", "Contacts complete"], blockers: 2 },
  { id: "PRJ-2064", project: "Northstar Annual Summit", score: 100, state: "BOOKED", checks: ["Contract complete", "Retainer paid", "Folders created", "Portal active"], blockers: 0 },
] as const;

export const integrations = [
  { provider: "QuickBooks Online", description: "Customers, invoices, and payment status", status: "Healthy", sync: "2 min ago", scope: "Accounting source of record", mock: false },
  { provider: "Google Calendar", description: "Availability, consultations, and events", status: "Healthy", sync: "4 min ago", scope: "Alder & Muse Production", mock: false },
  { provider: "Docusign", description: "Templates, envelopes, and completion evidence", status: "Healthy", sync: "8 min ago", scope: "Photography agreements", mock: false },
  { provider: "Dropbox", description: "Project folders and document storage", status: "Healthy", sync: "11 min ago", scope: "/StudioCue", mock: false },
  { provider: "Zoom", description: "Consultation meetings with waiting room", status: "Mock mode", sync: "Development", scope: "No live credentials", mock: true },
] as const;
