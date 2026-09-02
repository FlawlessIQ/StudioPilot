import { AppShell } from "@/components/layout/app-shell";
import { StudioProposalCenter } from "@/components/proposals/studio-proposal-workspace";

/**
 * `?record=acceptance` arrives from the job page's "Record their acceptance"
 * and is read here rather than in the client component: reading it after mount
 * meant a synchronous `setState` in an effect, and reading it during render
 * meant `window` on the server. The page already has the query string.
 */
export default async function ProposalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  return (
    <AppShell active="Proposals">
      <StudioProposalCenter
        recordingAcceptance={query.record === "acceptance"}
      />
    </AppShell>
  );
}
