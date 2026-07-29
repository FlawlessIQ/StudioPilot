import { PortalShell } from "@/components/layout/portal-shell";

export default function ClientLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <PortalShell>{children}</PortalShell>;
}
