import type { Metadata } from "next";
import { PublicConsultationScheduler } from "@/components/booking/public-consultation-scheduler";

export const metadata: Metadata = {
  // Also the final details call a month out (features/consultations/purpose.ts).
  // Neutral: the same page books a makeup trial and a final details call.
  title: "Choose a time",
  description: "Choose a time for a call with your photography studio.",
};

export default async function ConsultationSchedulingPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const token = (await searchParams).token ?? "";
  return <PublicConsultationScheduler token={token} />;
}
