import { AppShell } from "@/components/layout/app-shell";
import Link from "next/link";
import { QuestionnaireBuilder } from "@/components/planning/questionnaire-builder";
import { QuestionnaireReviewInsights } from "@/components/planning/questionnaire-review-insights";
import { LiveDomainView, ProjectContextBar } from "@/components/studio/live-domain-view";
import { PendingImportNotice } from "@/components/ai/pending-import-notice";

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
        <LiveDomainView domain="questionnaires" projectId={project} />
        {project ? (
          <section className="panel focused-tool-link">
            <div>
              <p className="eyebrow">Reusable setup</p>
              <h2>Need to change the questionnaire itself?</h2>
              <p>
                Keep client review focused. Template building and assignment
                tools live in the questionnaire library.
              </p>
            </div>
            <Link className="button button-light" href="/studio/questionnaires">
              Manage questionnaire templates
            </Link>
          </section>
        ) : (
          <QuestionnaireBuilder />
        )}
      </div>
    </AppShell>
  );
}
