import type { Metadata } from "next";
import { KitPreview } from "@/components/kit/kit-preview";

export const metadata: Metadata = {
  title: "Mobile kit",
  robots: { index: false, follow: false },
};

/**
 * The mobile kit on a real device: open /kit on a phone. `?color=%23RRGGBB`
 * previews a studio's colour. docs/mobile-first-client-crew-plan-2026-09-28.md
 */
export default async function KitPage({
  searchParams,
}: {
  searchParams: Promise<{ color?: string }>;
}) {
  const { color } = await searchParams;
  return <KitPreview initialColor={typeof color === "string" ? color : null} />;
}
