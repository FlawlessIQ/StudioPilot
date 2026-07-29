import type { Metadata } from "next";
import { PublicConsultationScheduler } from "@/components/booking/public-consultation-scheduler";

export const metadata: Metadata = {
  title: "Schedule your consultation",
  description: "Choose a secure consultation time with your photography studio.",
};

export default async function ConsultationSchedulingPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const token = (await searchParams).token ?? "";
  return <PublicConsultationScheduler token={token} />;
}
