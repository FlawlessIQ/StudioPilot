import type { Metadata } from "next";
import { SetupConversation } from "@/components/setup/setup-conversation";

// The tab read "StudioCue" — the one studio page with no name of its own,
// and the one a new studio keeps coming back to.
export const metadata: Metadata = { title: "Studio setup" };

export default function StudioSetupPage() {
  return <SetupConversation />;
}
