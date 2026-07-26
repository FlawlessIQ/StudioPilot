"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, LoaderCircle } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { runCrmCommand } from "@/lib/crm/command-client";

const schema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().min(10).max(3000),
  eventType: z.enum(["Wedding", "Corporate", "Sports"]),
  basePrice: z.coerce.number().positive(),
  retainerPercent: z.coerce.number().min(0).max(100),
  coverageHours: z.coerce.number().positive(),
  photographers: z.coerce.number().int().positive(),
  deliverables: z.string().trim().min(2),
  travelArea: z.string().trim().min(2),
  terms: z.string().trim().min(10),
});
type FormInput = z.input<typeof schema>;
type FormValues = z.output<typeof schema>;

export function CreatePackageForm() {
  const [outcome, setOutcome] = useState<{ persisted: boolean; reference: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormInput, unknown, FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", description: "", eventType: "Wedding", basePrice: 0, retainerPercent: 30, coverageHours: 8, photographers: 2, deliverables: "Online gallery, High-resolution downloads", travelArea: "Within 50 miles", terms: "Subject to the completed studio agreement." },
  });
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
        retainerRule: { type: "percentage", basisPoints: Math.round(values.retainerPercent * 100) },
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
      setOutcome({ persisted: command.persisted, reference: String(command.result.packageId ?? command.result.reference) });
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Package could not be created.");
    }
  });
  if (outcome) {
    return <div className="command-success"><CheckCircle2 size={23} /><h2>Package prepared</h2><p>Reference: {outcome.reference}</p>{!outcome.persisted ? <small>Preview mode: this record was not persisted.</small> : null}</div>;
  }
  return (
    <form className="command-form panel" onSubmit={submit}>
      <div className="form-grid">
        <label className="form-span">Package name<input {...register("name")} /><small>{errors.name?.message}</small></label>
        <label className="form-span">Description<textarea {...register("description")} rows={3} /><small>{errors.description?.message}</small></label>
        <label>Event type<select {...register("eventType")}><option>Wedding</option><option>Corporate</option><option>Sports</option></select></label>
        <label>Base price (USD)<input {...register("basePrice")} min="0.01" step="0.01" type="number" /></label>
        <label>Retainer percent<input {...register("retainerPercent")} min="0" max="100" step="0.01" type="number" /></label>
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
