import { redirect } from "next/navigation";

/**
 * Feedback triage moved into the Console inbox (docs/console.md). Team emails
 * already sent link here with `?id=`, so the id is carried across.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  redirect(id ? `/platform-admin/inbox?id=${encodeURIComponent(id)}` : "/platform-admin/inbox");
}
