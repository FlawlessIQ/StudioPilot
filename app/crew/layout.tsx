import { CrewPortalShell } from "@/components/crew/crew-portal-shell";

export default function CrewLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <CrewPortalShell>{children}</CrewPortalShell>;
}
