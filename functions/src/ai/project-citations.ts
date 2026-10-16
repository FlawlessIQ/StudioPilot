import { canCreateProposalForProject } from "../booking/proposal-domain.js";
import { tradeVocab } from "../trades/trades.js";

/** Navigation targets from the already-authorized project overview. */
export function projectCitationCandidates(
  projects: readonly Record<string, unknown>[],
  trade?: unknown,
): Array<{ label: string; href: string }> {
  const offer = tradeVocab(trade).proposal.toLowerCase();
  return projects.flatMap((project) => {
    const id = encodeURIComponent(String(project.id));
    const name = String(project.name ?? project.id);
    const targets = [{ label: name, href: `/studio/projects/${id}` }];
    if (!project.archivedAt && canCreateProposalForProject(String(project.state))) {
      const preparing = project.state === "CONSULTATION";
      targets.push({
        label: `${preparing ? "Prepare" : "View"} ${offer} — ${name}`,
        href: `/studio/proposals${preparing ? "/new" : ""}?project=${id}`,
      });
    }
    return targets;
  });
}
