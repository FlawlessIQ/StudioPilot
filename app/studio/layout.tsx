import "@/app/app-styles";
import { AppShell } from "@/components/layout/app-shell";

export default function StudioLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <AppShell>{children}</AppShell>;
}
