import { AppShell } from "@/components/layout/app-shell";
import { StudioProposalWorkspace } from "@/components/proposals/studio-proposal-workspace";

export default async function ProposalDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  return (
    <AppShell active="Proposals">
      <StudioProposalWorkspace
        id={id}
        // Carried from the proposals list, which carried it from the job page.
        // Opens the record-acceptance form instead of leaving it folded at the
        // bottom of a long document.
        recordAcceptance={query.record === "acceptance"}
      />
    </AppShell>
  );
}
