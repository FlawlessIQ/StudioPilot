import type { Firestore } from "firebase-admin/firestore";
import type { Auth } from "firebase-admin/auth";

/**
 * Everything a studio has told StudioCue about itself, and what it has done,
 * for its Console record (Conor, 2026-10-28: "since we are small scale at the
 * moment i would like much more info when i click on each studio").
 *
 * The studio row (consoleStudios, rollup.ts) holds counts for lists. This is
 * the long form, read when one record opens: the profile they entered, what
 * they built (packages, forms, hours, agreement, templates, integrations),
 * their jobs and inquiries, and the last things their people did. Read-only;
 * nothing is written or audited. Names and prices, never client contact
 * details or message bodies.
 */

const DAY = 86_400_000;
const STUDIO_ROLES = new Set(["studio_owner", "studio_admin", "studio_coordinator", "staff_photographer", "staff_videographer"]);
const BOOKED = new Set(["BOOKED", "PLANNING", "READY", "EVENT_DAY", "POST_PRODUCTION", "DELIVERY", "REVIEW"]);

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

export type StudioAction = {
  at: string;
  action: string;
  actorType: string;
  actorName: string | null;
  projectName: string | null;
};

export type StudioProfile = Awaited<ReturnType<typeof loadStudioProfile>>;

export async function loadStudioProfile(db: Firestore, auth: Auth, tenantId: string, now: Date) {
  const byTenant = (collection: string) => db.collection(collection).where("tenantId", "==", tenantId);
  const since30 = new Date(now.getTime() - 30 * DAY).toISOString();

  const [
    tenant,
    attribution,
    consultation,
    capture,
    coi,
    features,
    memberships,
    packages,
    forms,
    pointers,
    connections,
    projects,
    leads,
    emails30d,
    emailsFailed,
    actions,
  ] = await Promise.all([
    db.doc(`tenants/${tenantId}`).get(),
    db.doc(`saasAttribution/${tenantId}`).get(),
    db.doc(`consultationSettings/${tenantId}`).get(),
    db.doc(`leadCaptureSettings/${tenantId}`).get(),
    db.doc(`coiSettings/${tenantId}`).get(),
    db.doc(`tenantFeatures/${tenantId}`).get(),
    byTenant("memberships").get(),
    byTenant("packages").limit(60).get(),
    byTenant("questionnaireTemplates").limit(40).get(),
    byTenant("messageTemplatePointers").limit(80).get(),
    byTenant("integrationConnections").get(),
    byTenant("projects").select("name", "state", "eventDate", "createdAt", "archivedAt", "importedAt", "jobKind").get(),
    byTenant("leads").select("source", "createdAt", "status").get(),
    byTenant("emailJobs").where("createdAt", ">=", since30).count().get(),
    byTenant("emailJobs").where("status", "==", "dead_letter").count().get(),
    // A person's actions, not the system's: users, and the clients and crew
    // working with them.
    byTenant("auditEvents").where("actorType", "in", ["user", "client", "subcontractor"]).orderBy("timestamp", "desc").limit(80).get(),
  ]);
  if (!tenant.exists) return null;
  const t = tenant.data() ?? {};

  // ── Their people ──────────────────────────────────────────────────────
  const live = memberships.docs.filter((doc) => doc.get("status") === "active");
  const internal = live.filter((doc) => STUDIO_ROLES.has(String(doc.get("role"))));
  const uids = [...new Set(internal.map((doc) => String(doc.get("userId") ?? "")).filter(Boolean))].slice(0, 50);
  const users = uids.length ? (await auth.getUsers(uids.map((uid) => ({ uid })))).users : [];
  const userById = new Map(users.map((user) => [user.uid, user]));
  const team = internal.map((doc) => {
    const user = userById.get(String(doc.get("userId")));
    return {
      name: user?.displayName ?? text(doc.get("displayName")),
      email: user?.email ?? text(doc.get("email")),
      role: String(doc.get("role")),
      lastSignInAt: user?.metadata.lastSignInTime ? new Date(user.metadata.lastSignInTime).toISOString() : null,
    };
  });
  const nameByUid = new Map<string, string>();
  for (const doc of memberships.docs) {
    const name = userById.get(String(doc.get("userId")))?.displayName ?? text(doc.get("displayName"));
    if (name) nameByUid.set(String(doc.get("userId")), name);
  }

  // ── What they built ───────────────────────────────────────────────────
  const contract = record(t.defaultContractSettings);
  const signing = connections.docs
    .filter((doc) => !doc.get("archivedAt") && ["docusign", "dropbox_sign"].includes(String(doc.get("provider"))))
    .map((doc) => String(doc.get("provider")));
  const windows = Array.isArray(consultation.get("windows")) ? (consultation.get("windows") as unknown[]) : [];
  const branding = record(t.emailBranding);

  // ── Their business in StudioCue ───────────────────────────────────────
  const jobs = projects.docs.filter((doc) => !doc.get("archivedAt"));
  const byState: Record<string, number> = {};
  for (const doc of jobs) byState[String(doc.get("state") ?? "UNKNOWN")] = (byState[String(doc.get("state") ?? "UNKNOWN")] ?? 0) + 1;
  const today = now.toISOString().slice(0, 10);
  const in60 = new Date(now.getTime() + 60 * DAY).toISOString().slice(0, 10);
  const leadSources: Record<string, number> = {};
  for (const doc of leads.docs) {
    const source = text(doc.get("source")) ?? "unknown";
    leadSources[source] = (leadSources[source] ?? 0) + 1;
  }
  const projectName = new Map(projects.docs.map((doc) => [doc.id, text(doc.get("name"))]));

  const attributionData = attribution.exists ? (attribution.data() ?? {}) : null;
  const slug = text(t.publicSlug);
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://studio-cue.com").replace(/\/$/, "");

  return {
    readAt: now.toISOString(),
    about: {
      businessName: text(t.businessName),
      legalName: text(t.legalName),
      brandName: text(t.brandName),
      trade: text(t.trade) ?? "photographer",
      timezone: text(t.timezone),
      currency: text(t.currency),
      address: text(t.businessAddress),
      replyTo: text(branding.replyTo),
      inquiryUrl: slug ? `${appUrl}/inquiry/${slug}` : null,
      signedUpAt: text(t.createdAt),
      attribution: attributionData
        ? {
            heard: text(attributionData.heard),
            heardDetail: text(attributionData.heardDetail),
            source: text(attributionData.source),
            medium: text(attributionData.medium),
            campaign: text(attributionData.campaign),
            referrer: text(attributionData.referrer),
            landing: text(attributionData.landing),
            code: text(attributionData.code) ?? text(attributionData.promotionCode),
            manual: text(attributionData.manual),
          }
        : null,
    },
    team,
    built: {
      packages: packages.docs
        .filter((doc) => !doc.get("archivedAt"))
        .map((doc) => ({
          name: text(doc.get("name")) ?? "Untitled package",
          priceCents: num(doc.get("basePriceCents")),
          currency: text(doc.get("currency")),
          eventType: text(doc.get("eventTypeLabel")),
          active: doc.get("active") === true,
        }))
        .sort((a, b) => Number(b.active) - Number(a.active) || (b.priceCents ?? 0) - (a.priceCents ?? 0)),
      forms: forms.docs
        .filter((doc) => !doc.get("archivedAt"))
        .map((doc) => ({ name: text(doc.get("name")) ?? "Untitled form", status: text(doc.get("status")) })),
      agreement: {
        signatureMode: text(contract.signatureMode),
        hasTemplate: Boolean(text(contract.templateId) || text(contract.agreementTemplateId)),
        nativeSigning: features.get("nativeContractSigning") === true,
        signingProviders: signing,
      },
      consultation: consultation.exists
        ? {
            mode: text(consultation.get("mode")),
            durationMinutes: num(consultation.get("durationMinutes")),
            windows: windows
              .map((window) => record(window))
              .map((window) => ({ day: String(window.day ?? ""), startMinute: num(window.startMinute), endMinute: num(window.endMinute) })),
          }
        : null,
      inquiries: {
        lastForwardedAt: text(capture.get("lastCaptureAt")),
        lastTestAt: text(capture.get("lastTestCaptureAt")),
        formInquiries: leadSources.public_inquiry ?? 0,
      },
      customizedTemplates: pointers.docs.map((doc) => text(doc.get("templateKey")) ?? doc.id.replace(`${tenantId}_`, "")),
      integrations: connections.docs
        .filter((doc) => !doc.get("archivedAt"))
        .map((doc) => ({ provider: String(doc.get("provider") ?? "unknown"), status: text(doc.get("status")) })),
      branding: { logo: Boolean(text(branding.logoUrl) || text(branding.logoPath) || text(t.logoUrl)), color: text(branding.primaryColor) },
      insurance: coi.exists,
    },
    business: {
      jobsByState: byState,
      booked: jobs.filter((doc) => BOOKED.has(String(doc.get("state")))).length,
      imported: jobs.filter((doc) => text(doc.get("importedAt"))).length,
      upcoming60: jobs.filter((doc) => {
        const date = text(doc.get("eventDate"));
        return Boolean(date && date >= today && date <= in60);
      }).length,
      recentJobs: [...jobs]
        .sort((a, b) => String(b.get("createdAt") ?? "").localeCompare(String(a.get("createdAt") ?? "")))
        .slice(0, 8)
        .map((doc) => ({
          name: text(doc.get("name")) ?? "Untitled job",
          state: text(doc.get("state")),
          eventDate: text(doc.get("eventDate")),
          createdAt: text(doc.get("createdAt")),
          imported: Boolean(text(doc.get("importedAt"))),
          kind: text(doc.get("jobKind")),
        })),
      inquiries: {
        total: leads.size,
        last30: leads.docs.filter((doc) => String(doc.get("createdAt") ?? "") >= since30).length,
        bySource: leadSources,
      },
      clients: live.filter((doc) => doc.get("role") === "client").length,
      crew: live.filter((doc) => doc.get("role") === "subcontractor").length,
      emails30d: emails30d.data().count,
      emailsFailed: emailsFailed.data().count,
    },
    actions: actions.docs.map((doc): StudioAction => {
      const actor = String(doc.get("actorId") ?? "");
      return {
        at: String(doc.get("timestamp") ?? ""),
        action: String(doc.get("action") ?? ""),
        actorType: String(doc.get("actorType") ?? ""),
        actorName: nameByUid.get(actor) ?? null,
        projectName: text(doc.get("projectId")) ? (projectName.get(String(doc.get("projectId"))) ?? null) : null,
      };
    }),
  };
}
