import { AppShell } from "@/components/layout/app-shell";
import { QuestionnaireBuilder } from "@/components/planning/questionnaire-builder";
import { LiveDomainView } from "@/components/studio/live-domain-view";

export default function QuestionnairesPage() {
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
        <LiveDomainView domain="questionnaires" />
        <QuestionnaireBuilder />
      </div>
    </AppShell>
  );
}
