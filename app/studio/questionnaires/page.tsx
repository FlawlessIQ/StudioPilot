import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import Link from "next/link";
import { QuestionnaireBuilder } from "@/components/planning/questionnaire-builder";
import { QuestionnaireQuickSend } from "@/components/planning/questionnaire-quick-send";
import { QuestionnaireReviewInsights } from "@/components/planning/questionnaire-review-insights";
import { InquiryEventFormSetting } from "@/components/planning/inquiry-event-form-setting";
import { RecommendedQuestionnaires } from "@/components/planning/recommended-questionnaires";
import { LiveDomainView, ProjectContextBar } from "@/components/studio/live-domain-view";
import { PendingImportNotice } from "@/components/ai/pending-import-notice";

// Every studio page names itself on its tab; these fell back to
// "StudioCue · Photography Operations OS" (UI audit, 2026-10-02).
export const metadata: Metadata = { title: "Questionnaires" };

export default async function QuestionnairesPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { project } = await searchParams;
  return (
    <AppShell active="Questionnaires">
      <div className="live-domain-page">
        <header className="page-heading">
          <div>
            <p className="eyebrow">Client information</p>
            <h1>Questionnaires</h1>
            <p>
              Collect the details your team needs, without chasing long email
              threads.
            </p>
          </div>
        </header>
        {!project ? <PendingImportNotice destination="questionnaires" /> : null}
        {project ? <ProjectContextBar projectId={project} /> : null}
        {project ? <QuestionnaireReviewInsights projectId={project} /> : null}
        {/* The journey's "Send the form" lands here, so the first thing on the
            page is that. See components/planning/questionnaire-quick-send.tsx. */}
        {project ? <QuestionnaireQuickSend projectId={project} /> : null}
        <LiveDomainView domain="questionnaires" projectId={project} />
        {project ? (
          <>
            {/* The journey's "Send the form" lands here; assignment must be
                possible in place, not a template-library detour away. */}
            <QuestionnaireBuilder defaultMode="assign" defaultProjectId={project} />
            <section className="panel focused-tool-link">
              <div>
                <p className="eyebrow">Reusable setup</p>
                <h2>Need to change the questionnaire itself?</h2>
                <p>
                  Template building lives in the questionnaire library, so
                  client review stays focused here.
                </p>
              </div>
              <Link className="button button-light" href="/studio/questionnaires">
                Manage questionnaire templates
              </Link>
            </section>
          </>
        ) : (
          <>
            {/* Which form new wedding inquiries fill in before the call. */}
            <InquiryEventFormSetting />
            {/* GR Productions' wedding forms, for any studio to copy. */}
            <RecommendedQuestionnaires />
            <QuestionnaireBuilder />
          </>
        )}
      </div>
    </AppShell>
  );
}
