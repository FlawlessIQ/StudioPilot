export const crewProfiles = [
  { id: "crew-jordan", name: "Jordan Reid", initials: "JR", specialties: "Weddings · Events", area: "NYC + Hudson Valley", documents: "Complete", assignments: 8, availability: "Available Aug 15" },
  { id: "crew-amara", name: "Amara Chen", initials: "AC", specialties: "Corporate · Portraits", area: "New York City", documents: "Insurance due", assignments: 5, availability: "Tentative Aug 22" },
  { id: "crew-eli", name: "Eli Brooks", initials: "EB", specialties: "Sports · Events", area: "Tri-state area", documents: "Complete", assignments: 11, availability: "Available Sep 12" },
] as const;

export const crewAssignments = [
  { id: "wedding-booked-second", project: "Maya & Theo Johnson", projectId: "wedding-booked", role: "Second photographer", date: "Aug 15, 2026", arrival: "1:15 PM", departure: "9:30 PM", location: "The Foundry, Long Island City", status: "Accepted", crew: "Jordan Reid", schedule: "v4 acknowledgement due", compensation: "$800 flat" },
  { id: "wedding-ready-assistant", project: "Sofia & Miles Carter", projectId: "wedding-ready", role: "Lighting assistant", date: "Aug 22, 2026", arrival: "2:00 PM", departure: "8:00 PM", location: "Cedar Lakes Estate", status: "Invited", crew: "Jordan Reid", schedule: "Publishes Aug 8", compensation: "$450 flat" },
  { id: "sports-lead", project: "Hudson Valley Fall Media Day", projectId: "sports", role: "Team portrait lead", date: "Sep 12, 2026", arrival: "7:00 AM", departure: "2:00 PM", location: "Hudson Valley Athletic Complex", status: "Accepted", crew: "Eli Brooks", schedule: "Current · v2", compensation: "$950 flat" },
] as const;

export const crewRequirements = [
  { id: "w9", name: "Verified W-9", status: "Complete", detail: "Reviewed Jul 20" },
  { id: "insurance", name: "Liability insurance", status: "Complete", detail: "Expires Mar 4, 2027" },
  { id: "contract", name: "Subcontractor agreement", status: "Complete", detail: "Docusign evidence stored" },
  { id: "equipment", name: "Event-day equipment", status: "Complete", detail: "Confirmed Jul 21" },
  { id: "schedule", name: "Current schedule v4", status: "Action required", detail: "Version 3 was acknowledged" },
] as const;

export const crewSchedule = [
  { time: "1:15 PM", end: "1:30 PM", title: "Arrival & lead check-in", location: "The Boro Hotel lobby", responsibility: "Meet Conor; equipment check" },
  { time: "1:30 PM", end: "2:45 PM", title: "Getting ready coverage", location: "The Boro Hotel", responsibility: "Partner two + candid details" },
  { time: "4:30 PM", end: "5:10 PM", title: "Ceremony", location: "The Foundry", responsibility: "Processional and guest reactions" },
  { time: "5:15 PM", end: "6:10 PM", title: "Cocktail hour", location: "The Foundry courtyard", responsibility: "Guest candids; room details" },
  { time: "6:15 PM", end: "9:30 PM", title: "Reception coverage", location: "The Foundry", responsibility: "Alternate angles and dance floor" },
] as const;
