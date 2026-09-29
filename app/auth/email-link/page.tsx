import type { Metadata } from "next";
import { KitRoot, Main, PoweredBy } from "@/components/kit/kit";
import { EmailLinkAction } from "@/features/auth/email-link-action";

export const metadata: Metadata = {
  title: "Sign in",
};

/**
 * Where an emailed sign-in link lands. In the mobile kit (it was the old
 * StudioCue auth page, with the logo and eyebrow overlapping and the form
 * halfway down an iPhone screen; seen in Safari on the iOS Simulator during
 * the local UAT run, 2026-09-29). The studio isn't known until sign-in, so
 * it stays neutral rather than StudioCue-branded.
 */
export default async function EmailLinkPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next = null } = await searchParams;
  return (
    <KitRoot>
      <div className="kit-screen">
        <Main label="Sign in">
          <div className="kit-stack-tight">
            <p className="kit-eyebrow">Signing you in</p>
            <h1 className="kit-title">{next?.startsWith("/crew") ? "Open your work" : "Open your wedding"}</h1>
          </div>
          <EmailLinkAction next={next} />
          <PoweredBy />
        </Main>
      </div>
    </KitRoot>
  );
}
