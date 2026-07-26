export const workflowTemplates = [
  {
    id: "wedding-v7",
    name: "Wedding Photography",
    eventType: "Wedding",
    description: "Inquiry through delivery with booking, planning, readiness, and review gates.",
    version: 7,
    checkpoints: 38,
    automations: 14,
    activeProjects: 18,
    status: "Active",
  },
  {
    id: "corporate-v2",
    name: "Corporate Photography",
    eventType: "Corporate",
    description: "Scope, usage rights, approvals, purchase orders, production, and delivery.",
    version: 2,
    checkpoints: 19,
    automations: 8,
    activeProjects: 5,
    status: "Active",
  },
  {
    id: "sports-v1",
    name: "Sports Photography",
    eventType: "Sports",
    description: "Organization approvals, parent-managed releases, assignments, and delivery.",
    version: 1,
    checkpoints: 17,
    automations: 6,
    activeProjects: 2,
    status: "Review",
  },
] as const;

export type WorkflowCheckpointPreview = {
  name: string;
  owner: string;
  due: string;
  status: string;
  blocking: boolean;
};

export const workflowStages: ReadonlyArray<{
  label: string;
  checkpoints: readonly WorkflowCheckpointPreview[];
}> = [
  {
    label: "Booking",
    checkpoints: [
      { name: "Contract completed", owner: "Client", due: "At booking", status: "Complete", blocking: true },
      { name: "Retainer paid", owner: "Client", due: "At booking", status: "Complete", blocking: true },
      { name: "Create project workspace", owner: "System", due: "At booking", status: "Complete", blocking: false },
    ],
  },
  {
    label: "Planning",
    checkpoints: [
      { name: "Questionnaire complete", owner: "Client", due: "45 days before", status: "Complete", blocking: true },
      { name: "Venue contacts confirmed", owner: "Studio", due: "30 days before", status: "In progress", blocking: true },
      { name: "COI approved and sent", owner: "Studio", due: "21 days before", status: "Under review", blocking: true },
    ],
  },
  {
    label: "Event readiness",
    checkpoints: [
      { name: "Final schedule approved", owner: "Client", due: "14 days before", status: "Waiting on client", blocking: true },
      { name: "Crew acknowledged schedule", owner: "Crew", due: "7 days before", status: "Not started", blocking: true },
      { name: "Final balance paid", owner: "Client", due: "14 days before", status: "Complete", blocking: true },
    ],
  },
];

export const workflowTasks = [
  { id: "TSK-731", title: "Review Johnson schedule comments", project: "Maya & Theo Johnson", due: "Today", owner: "Reese Morgan", priority: "Urgent", status: "In progress", blocking: true },
  { id: "TSK-726", title: "Confirm Foundry COI wording", project: "Maya & Theo Johnson", due: "Today", owner: "Conor Lawless", priority: "High", status: "Waiting", blocking: true },
  { id: "TSK-718", title: "Request Northstar final shot list", project: "Northstar Annual Summit", due: "Jul 29", owner: "Reese Morgan", priority: "Normal", status: "Not started", blocking: false },
  { id: "TSK-709", title: "Publish Carter crew brief", project: "Sofia & Miles Carter", due: "Aug 10", owner: "Conor Lawless", priority: "Normal", status: "Not started", blocking: false },
] as const;

export const readinessProjects = [
  { id: "PRJ-2048", name: "Maya & Theo Johnson", date: "Aug 15", score: 72, ready: false, blocking: 3, overdue: 1, atRisk: 2, next: "Final schedule approval", owner: "Client" },
  { id: "PRJ-2051", name: "Sofia & Miles Carter", date: "Aug 22", score: 100, ready: true, blocking: 0, overdue: 0, atRisk: 0, next: "Event-day briefing", owner: "Studio" },
  { id: "PRJ-2064", name: "Northstar Annual Summit", date: "Sep 4", score: 46, ready: false, blocking: 5, overdue: 0, atRisk: 1, next: "Final shot list", owner: "Client" },
  { id: "PRJ-2072", name: "Hudson Valley Athletics", date: "Sep 12", score: 24, ready: false, blocking: 7, overdue: 2, atRisk: 0, next: "Organization agreement", owner: "Client" },
] as const;

export const automationRuns = [
  { id: "RUN-9921", rule: "Questionnaire received", project: "Maya & Theo Johnson", actions: 3, status: "Succeeded", time: "8 min ago", attempts: 1 },
  { id: "RUN-9918", rule: "Final invoice schedule", project: "Sofia & Miles Carter", actions: 2, status: "Succeeded", time: "31 min ago", attempts: 1 },
  { id: "RUN-9912", rule: "COI correction escalation", project: "Maya & Theo Johnson", actions: 2, status: "Retry scheduled", time: "1 hr ago", attempts: 2 },
  { id: "RUN-9904", rule: "Crew acceptance received", project: "Northstar Annual Summit", actions: 3, status: "Succeeded", time: "Yesterday", attempts: 1 },
] as const;

export const auditEvents = [
  { id: "AUD-901", action: "Checkpoint completed", entity: "Final balance paid", project: "Sofia & Miles Carter", actor: "QuickBooks webhook", type: "Provider", time: "12 min ago" },
  { id: "AUD-898", action: "Workflow instantiated", entity: "Wedding Photography v7", project: "Priya & Jordan", actor: "StudioHub", type: "System", time: "41 min ago" },
  { id: "AUD-892", action: "Checkpoint waived", entity: "Parking instructions", project: "Maya & Theo Johnson", actor: "Conor Lawless", type: "User", time: "2 hr ago" },
  { id: "AUD-881", action: "Project state changed", entity: "BOOKED → PLANNING", project: "Northstar Annual Summit", actor: "Reese Morgan", type: "User", time: "Yesterday" },
] as const;
