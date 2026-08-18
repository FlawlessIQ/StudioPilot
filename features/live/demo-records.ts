/**
 * Demo-mode records for every tenant collection the UI reads.
 *
 * Extracted from components/live/tenant-records.tsx so the mapping is a pure
 * module: no React, no Firebase. That lets tests exercise the real fixture
 * shapes against the real projection instead of re-describing them and
 * drifting from what the app actually renders.
 */
import { crmLeads, crmProjects } from "@/config/crm-demo-data";
import {
  crewAssignments as demoCrewAssignments,
  crewProfiles as demoCrewProfiles,
  crewSchedule as demoCrewSchedule,
} from "@/config/crew-demo-data";
import {
  consultations as demoConsultations,
  contracts as demoContracts,
  invoices as demoInvoices,
  proposals as demoProposals,
} from "@/config/booking-demo-data";
import {
  coiCases as demoInsuranceCases,
  questionnaires as demoQuestionnaires,
} from "@/config/planning-demo-data";
import {
  automationRuns as demoAutomationRuns,
  readinessProjects as demoReadinessProjects,
} from "@/config/workflow-demo-data";
import {
  demoActionReceipts,
  demoAiActions,
  demoAutomationApprovals,
  demoBookingOrchestrations,
  demoCommunicationDrafts,
  demoCrewCascades,
  demoDeliveryDrafts,
  demoTasks,
} from "@/config/ai-demo-data";

export type TenantDocument = Record<string, unknown> & { id: string };

function demoIsoDate(value: string): string {
  const parsed = new Date(`${value} 12:00:00`);
  return Number.isNaN(parsed.valueOf())
    ? value
    : parsed.toISOString().slice(0, 10);
}

/** Hours ago -> ISO timestamp, so demo records always look freshly touched. */
function demoHoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

/** Days from today -> YYYY-MM-DD; negative values are overdue. */
function demoDueDate(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

function demoProjectId(name: string): string {
  const exact = crmProjects.find((project) => project.name === name);
  if (exact) return exact.id;
  if (name.toLowerCase().includes("hudson")) return "PRJ-2072";
  return crmProjects[0]?.id ?? "PRJ-2048";
}

function demoDateTime(date: string, time: string): string {
  const parsed = new Date(`${date} ${time}`);
  return Number.isNaN(parsed.valueOf())
    ? new Date().toISOString()
    : parsed.toISOString();
}

export function demoTenantDocuments(collectionName: string): TenantDocument[] {
  switch (collectionName) {
    case "projects":
      return crmProjects.map((project) => ({
        id: project.id,
        name: project.name,
        eventType: project.event,
        eventDate: demoIsoDate(project.date),
        venueName: project.venue,
        city: "New York",
        state: project.state,
        readinessScore: project.readiness,
        nextAction: project.nextAction,
        leadPhotographerName: project.owner,
      }));
    case "leads":
      return crmLeads.map((lead, index) => ({
        id: lead.id,
        displayName: lead.name,
        name: lead.name,
        eventType: lead.event,
        eventDate: demoIsoDate(lead.date),
        venue: lead.venue,
        venueName: lead.venue,
        referralSource: lead.source,
        status: lead.status.toLowerCase(),
        assignedToName: lead.assigned,
        createdAt: new Date(Date.now() - index * 86_400_000).toISOString(),
        email:
          index === 0
            ? "lena.ortiz@example.test"
            : index === 1
              ? "events@hearthwell.example.test"
              : "noah.elise@example.test",
        phone: index === 2 ? "" : index === 0 ? "+1 212 555 0187" : "+1 646 555 0144",
        missingFields:
          lead.missing === 0
            ? []
            : index === 0
              ? ["budget range"]
              : ["phone number", "confirmed venue", "budget range"],
      }));
    case "crewProfiles":
      return demoCrewProfiles.map((profile, index) => ({
        id: profile.id,
        name: profile.name,
        active: true,
        specialties: profile.specialties.split(" · ").map((value) => value.toLowerCase()),
        serviceAreas: [profile.area],
        travelRadiusMiles: 100,
        preferenceRank: index + 1,
        w9Status: "complete",
        insuranceStatus: profile.documents === "Complete" ? "complete" : "attention_required",
        contractStatus: "complete",
        rateCents: index === 0 ? 80000 : index === 1 ? 65000 : 95000,
      }));
    case "crewAssignments":
      return demoCrewAssignments.map((assignment) => ({
        id: assignment.id,
        projectId: demoProjectId(assignment.project),
        crewProfileId:
          demoCrewProfiles.find((profile) => profile.name === assignment.crew)?.id ?? "",
        crewName: assignment.crew,
        role: assignment.role,
        status: assignment.status.toLowerCase(),
        arrivalAt: demoDateTime(assignment.date, assignment.arrival),
        departureAt: demoDateTime(assignment.date, assignment.departure),
        acknowledgedScheduleVersion: assignment.status === "Accepted" ? 3 : 0,
      }));
    case "schedules": {
      const project = crmProjects[0]!;
      const eventDate = demoIsoDate(project.date);
      return [{
        id: "schedule-demo-prj-2048",
        projectId: project.id,
        projectName: project.name,
        status: "published",
        version: 4,
        items: demoCrewSchedule.map((item, index) => ({
          id: `schedule-item-${index + 1}`,
          title: item.title,
          location: item.location,
          startAt: demoDateTime(eventDate, item.time),
          endAt: demoDateTime(eventDate, item.end),
        })),
      }];
    }
    case "questionnaireResponses":
      return demoQuestionnaires.map((questionnaire, index) => ({
        id: `questionnaire-demo-${index + 1}`,
        projectId: demoProjectId(questionnaire.project),
        projectName: questionnaire.project,
        templateName: questionnaire.template,
        completionPercent: questionnaire.progress,
        status: questionnaire.status.toLowerCase().replaceAll(" ", "_"),
        dueDate: questionnaire.due === "Complete" ? null : questionnaire.due,
        missingInformation:
          questionnaire.missing === "None" ? [] : [questionnaire.missing],
      }));
    case "readinessAssessments":
      return demoReadinessProjects.map((item) => ({
        id: `readiness-${item.id}`,
        projectId: item.id,
        score: item.score,
        ready: item.ready,
      }));
    case "insuranceRequests":
      return demoInsuranceCases.map((item, index) => ({
        id: `insurance-demo-${index + 1}`,
        projectId: demoProjectId(item.project),
        projectName: item.project,
        venueName: item.venue,
        status:
          item.status === "Approved"
            ? "sent_to_venue"
            : item.status === "Correction required"
              ? "correction_required"
              : "under_review",
      }));
    case "invoiceReferences":
      return demoInvoices.map((invoice) => ({
        id: invoice.id,
        projectId: demoProjectId(invoice.project),
        projectName: invoice.project,
        kind: invoice.kind,
        amountCents: Math.round(Number(invoice.amount.replace(/[$,]/g, "")) * 100),
        balanceCents: Math.round(Number(invoice.balance.replace(/[$,]/g, "")) * 100),
        status: invoice.status.toLowerCase(),
        // Unpaid demo invoices carry a real past-due date so the overdue-balance
        // path is exercised. Paid ones get a past date too — status, not the
        // date, is what excludes them.
        dueDate: demoDueDate(invoice.status.toLowerCase() === "paid" ? -30 : -6),
      }));
    case "consultations":
      return demoConsultations.map((item) => ({
        ...item,
        projectId: demoProjectId(item.project),
        status: item.status.toLowerCase(),
      }));
    case "proposals":
      return demoProposals.map((item) => ({
        ...item,
        projectId: demoProjectId(item.project),
        status: item.status.toLowerCase(),
      }));
    case "contracts":
      return demoContracts.map((item) => ({
        ...item,
        projectId: demoProjectId(item.project),
        status: item.status === "Completed" ? "completed" : "sent",
      }));
    case "automationRuns":
      return demoAutomationRuns.map((item) => ({
        ...item,
        projectId: demoProjectId(item.project),
        status: item.status === "Succeeded" ? "completed" : "retry_scheduled",
      }));
    case "aiActions":
      return demoAiActions.map((action) => ({
        id: action.id,
        projectId: demoProjectId(action.project),
        projectName: action.project,
        capability: action.capability,
        title: action.title,
        status: action.status,
        authorityBoundary: action.authorityBoundary,
        confidence: action.confidence,
        validation: action.validation,
        sourceReferences: action.sourceReferences,
        downstreamCommand: action.downstreamCommand,
        structuredOutput: action.structuredOutput,
        snoozedUntil: action.snoozedUntil,
        createdAt: demoHoursAgo(action.ageHours),
        updatedAt: demoHoursAgo(action.ageHours),
      }));
    case "actionReceipts":
      return demoActionReceipts.map((receipt) => ({
        id: receipt.id,
        projectId: demoProjectId(receipt.project),
        projectName: receipt.project,
        title: receipt.title,
        summary: receipt.summary,
        status: receipt.status,
        providerEvidence: receipt.providerEvidence,
        canRetry: receipt.canRetry,
        canCancel: receipt.canCancel,
        createdAt: demoHoursAgo(receipt.ageHours),
        updatedAt: demoHoursAgo(receipt.ageHours),
      }));
    case "automationApprovals":
      return demoAutomationApprovals.map((approval) => ({
        id: approval.id,
        projectId: demoProjectId(approval.project),
        projectName: approval.project,
        actionType: approval.actionType,
        status: approval.status,
        requestedAt: demoHoursAgo(approval.ageHours),
        updatedAt: demoHoursAgo(approval.ageHours),
      }));
    case "communicationDrafts":
      return demoCommunicationDrafts.map((draft) => ({
        id: draft.id,
        projectId: demoProjectId(draft.project),
        projectName: draft.project,
        subject: draft.subject,
        body: draft.body,
        recipient: draft.recipient,
        status: draft.status,
        updatedAt: demoHoursAgo(draft.ageHours),
      }));
    case "deliveryDrafts":
      return demoDeliveryDrafts.map((draft) => ({
        id: draft.id,
        projectId: demoProjectId(draft.project),
        projectName: draft.project,
        status: draft.status,
        galleryUrl: draft.galleryUrl,
        updatedAt: demoHoursAgo(draft.ageHours),
      }));
    case "bookingOrchestrations":
      return demoBookingOrchestrations.map((item) => ({
        id: item.id,
        projectId: demoProjectId(item.project),
        projectName: item.project,
        status: item.status,
        currentStep: item.currentStep,
        updatedAt: demoHoursAgo(item.ageHours),
      }));
    case "crewCascades":
      return demoCrewCascades.map((item) => ({
        id: item.id,
        projectId: demoProjectId(item.project),
        projectName: item.project,
        role: item.role,
        status: item.status,
        candidateIndex: item.candidateIndex,
        candidateCount: item.candidateCount,
        updatedAt: demoHoursAgo(item.ageHours),
      }));
    case "tasks":
      return demoTasks.map((task) => ({
        id: task.id,
        projectId: demoProjectId(task.project),
        projectName: task.project,
        title: task.title,
        status: task.status,
        dueDate: demoDueDate(task.dueInDays),
        dueAt: demoDueDate(task.dueInDays),
        updatedAt: demoHoursAgo(2),
      }));
    default:
      return [];
  }
}
