import { IssueRecord } from "@/components/console/pages/issues-page";

export default async function Page({ params }: { params: Promise<{ issueId: string }> }) {
  const { issueId } = await params;
  return <IssueRecord issueId={decodeURIComponent(issueId)} />;
}
