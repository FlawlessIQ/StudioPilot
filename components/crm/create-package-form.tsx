"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, CheckCircle2, LoaderCircle } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { friendlyError } from "@/lib/ai/friendly-error";
import { runCrmCommand } from "@/lib/crm/command-client";

const schema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().min(10).max(3000),
  eventType: z.enum(["Wedding", "Corporate", "Sports"]),
  basePrice: z.coerce.number().positive(),
  retainerMode: z.enum(["percentage", "fixed", "per_crew_member"]),
  retainerAmount: z.coerce.number().min(0),
  coverageHours: z.coerce.number().positive(),
  photographers: z.coerce.number().int().positive(),
  deliverables: z.string().trim().min(2),
  travelArea: z.string().trim().min(2),
  terms: z.string().trim().min(10),
});
type FormInput = z.input<typeof schema>;
type FormValues = z.output<typeof schema>;

export function CreatePackageForm({
  returnTo = null,
}: {
  /** A /studio/… path to return to after creating (e.g. a proposal flow). */
  returnTo?: string | null;
} = {}) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<{
    persisted: boolean;
    name: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm<FormInput, unknown, FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", description: "", eventType: "Wedding", basePrice: 0, retainerMode: "percentage", retainerAmount: 30, coverageHours: 8, photographers: 2, deliverables: "Online gallery, High-resolution downloads", travelArea: "Within 50 miles", terms: "Subject to the completed studio agreement." },
  });
  const retainerMode = watch("retainerMode");
  const submit = handleSubmit(async (values) => {
    setError(null);
    try {
      const command = await runCrmCommand("createPackage", {
        name: values.name,
        description: values.description,
        eventTypeId: values.eventType.toLowerCase(),
        eventTypeLabel: values.eventType,
        basePriceCents: Math.round(values.basePrice * 100),
        currency: "USD",
        retainerRule:
          values.retainerMode === "percentage"
            ? { type: "percentage" as const, basisPoints: Math.round(values.retainerAmount * 100) }
            : values.retainerMode === "fixed"
              ? { type: "fixed" as const, amountCents: Math.round(values.retainerAmount * 100) }
              : { type: "per_crew_member" as const, amountPerCrewCents: Math.round(values.retainerAmount * 100) },
        includedCoverageMinutes: Math.round(values.coverageHours * 60),
        includedPhotographers: values.photographers,
        includedDeliverables: values.deliverables.split(",").map((item) => item.trim()).filter(Boolean),
        includedTravelArea: values.travelArea,
        addOns: [],
        taxRateBasisPoints: 0,
        terms: values.terms,
        active: true,
        publicVisible: false,
        displayOrder: 0,
        internalNotes: null,
      });
      if (command.persisted && returnTo) {
        // The picker promised "come back — the proposal picks up where you
        // left off"; keep that promise without another click.
        router.push(returnTo);
        return;
      }
      setOutcome({ persisted: command.persisted, name: values.name });
    } catch (caught: unknown) {
      setError(friendlyError(caught, "The package could not be created. Try again."));
    }
  });
  if (outcome) {
    return (
      <div className="command-success">
        <CheckCircle2 size={23} />
        <h2>{outcome.name} is ready</h2>
        <p>Clients can now be offered this package in proposals.</p>
        {outcome.persisted ? (
          <Link className="button button-dark" href="/studio/packages">
            View packages <ArrowRight size={15} />
          </Link>
        ) : (
          <small>Preview mode: this record was not persisted.</small>
        )}
      </div>
    );
  }
  return (
    <form className="command-form panel" onSubmit={submit}>
      <div className="form-grid">
        <label className="form-span">Package name<input {...register("name")} /><small>{errors.name?.message}</small></label>
        <label className="form-span">Description<textarea {...register("description")} rows={3} /><small>{errors.description?.message}</small></label>
        <label>Event type<select {...register("eventType")}><option>Wedding</option><option>Corporate</option><option>Sports</option></select></label>
        <label>Base price (USD)<input {...register("basePrice")} min="0.01" step="0.01" type="number" /></label>
        <label>Retainer type<select {...register("retainerMode")}><option value="percentage">Percent of total</option><option value="fixed">Fixed amount</option><option value="per_crew_member">Per crew member</option></select></label>
        <label>{retainerMode === "percentage" ? "Retainer percent" : retainerMode === "fixed" ? "Retainer amount (USD)" : "Amount per crew member (USD)"}<input {...register("retainerAmount")} min="0" step="0.01" type="number" /><small>{errors.retainerAmount?.message}</small></label>
        <label>Coverage hours<input {...register("coverageHours")} min="0.5" step="0.5" type="number" /></label>
        <label>Photographers<input {...register("photographers")} min="1" type="number" /></label>
        <label>Travel area<input {...register("travelArea")} /></label>
        <label className="form-span">Deliverables (comma separated)<input {...register("deliverables")} /></label>
        <label className="form-span">Terms<textarea {...register("terms")} rows={3} /></label>
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="button button-dark" disabled={isSubmitting} type="submit">{isSubmitting ? <LoaderCircle className="spin" size={16} /> : null}Create package</button>
    </form>
  );
}
