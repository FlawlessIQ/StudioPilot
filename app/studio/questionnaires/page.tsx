import { AppShell } from "@/components/layout/app-shell";
import { QuestionnaireBuilder } from "@/components/planning/questionnaire-builder";
import { LiveDomainView, ProjectContextBar } from "@/components/studio/live-domain-view";

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
        {project ? <ProjectContextBar projectId={project} /> : null}
        <LiveDomainView domain="questionnaires" projectId={project} />
        <QuestionnaireBuilder />
      </div>
    </AppShell>
  );
}
