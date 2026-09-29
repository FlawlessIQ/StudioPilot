import { AppShell } from "@/components/layout/app-shell";
import { QuestionnaireResponseView } from "@/components/planning/questionnaire-response-view";

export default async function QuestionnaireResponsePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AppShell active="Questionnaires">
      <QuestionnaireResponseView id={id} />
    </AppShell>
  );
}
