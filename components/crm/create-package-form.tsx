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

const schema = z
  .object({
    /**
     * Messages in the studio's words, not Zod's.
     *
     * With the error slots added, the default text arrived verbatim — "Too
     * small: expected string to have >=10 characters" under Description, on
     * the first form a new studio has to complete. The bound is the same; the
     * sentence is now one a photographer can act on.
     */
    name: z
      .string()
      .trim()
      .min(2, "Give the package a name clients will recognise.")
      .max(120, "Keep the name under 120 characters."),
    description: z
      .string()
      .trim()
      .min(10, "A sentence or two on what this package includes.")
      .max(3000, "Keep the description under 3,000 characters."),
    eventType: z.enum(["Wedding", "Corporate", "Sports"]),
    basePrice: z.coerce
      .number()
      .positive("Set a price above zero."),
    retainerMode: z.enum(["percentage", "fixed", "per_crew_member"]),
    retainerAmount: z.coerce
      .number()
      .min(0, "A retainer cannot be negative."),
    coverageHours: z.coerce
      .number()
      .positive("How many hours of coverage this includes."),
    photographers: z.coerce
      .number()
      .int("Whole photographers only.")
      .positive("At least one photographer."),
    deliverables: z
      .string()
      .trim()
      .min(2, "List what the client receives, separated by commas."),
    travelArea: z
      .string()
      .trim()
      .min(2, "Where this price covers travel to."),
    terms: z
      .string()
      .trim()
      .min(10, "A short summary of your terms for this package."),
  })
  /**
   * A retainer percentage over 100 is not a retainer.
   *
   * The field is labelled "Retainer percent" and carried `min="0"` with no
   * maximum, so it invited the value; the server capped `basisPoints` at
   * 10000 and refused, and the refusal reached the studio as "The package
   * could not be created. Try again." on the one page a new studio must
   * finish before it can send a proposal. The server keeps its cap — this
   * stops the form offering the mistake.
   */
  .superRefine((values, context) => {
    if (values.retainerMode === "percentage" && values.retainerAmount > 100) {
      context.addIssue({
        code: "custom",
        path: ["retainerAmount"],
        message: "A percentage cannot be more than 100.",
      });
    }
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
      {/* Every field here is required by the schema and by the server, and not
          one of them said so — no `Required` marks and no `required`
          attributes, on the page a new studio has to finish before it can send
          its first proposal. `/studio/projects/new`, two clicks earlier, marks
          its fields properly; this is that treatment. Errors are surfaced on
          all of them too: only three had a slot to appear in, so a rejection
          on any of the other eight showed nothing at all. */}
      <div className="form-grid">
        <label className="form-span">
          Package name <span className="required-mark">Required</span>
          <input {...register("name")} />
          <small>{errors.name?.message}</small>
        </label>
        <label className="form-span">
          Description <span className="required-mark">Required</span>
          <textarea {...register("description")} rows={3} />
          <small>{errors.description?.message}</small>
        </label>
        <label>
          Event type <span className="required-mark">Required</span>
          <select {...register("eventType")}>
            <option>Wedding</option>
            <option>Corporate</option>
            <option>Sports</option>
          </select>
          <small>{errors.eventType?.message}</small>
        </label>
        <label>
          Base price (USD) <span className="required-mark">Required</span>
          <input {...register("basePrice")} min="0.01" step="0.01" type="number" />
          <small>{errors.basePrice?.message}</small>
        </label>
        <label>
          Retainer type <span className="required-mark">Required</span>
          <select {...register("retainerMode")}>
            <option value="percentage">Percent of total</option>
            <option value="fixed">Fixed amount</option>
            <option value="per_crew_member">Per crew member</option>
          </select>
          <small>{errors.retainerMode?.message}</small>
        </label>
        <label>
          {retainerMode === "percentage"
            ? "Retainer percent"
            : retainerMode === "fixed"
              ? "Retainer amount (USD)"
              : "Amount per crew member (USD)"}{" "}
          <span className="required-mark">Required</span>
          <input
            {...register("retainerAmount")}
            max={retainerMode === "percentage" ? 100 : undefined}
            min="0"
            step="0.01"
            type="number"
          />
          <small>{errors.retainerAmount?.message}</small>
        </label>
        <label>
          Coverage hours <span className="required-mark">Required</span>
          <input {...register("coverageHours")} min="0.5" step="0.5" type="number" />
          <small>{errors.coverageHours?.message}</small>
        </label>
        <label>
          Photographers <span className="required-mark">Required</span>
          <input {...register("photographers")} min="1" type="number" />
          <small>{errors.photographers?.message}</small>
        </label>
        <label>
          Travel area <span className="required-mark">Required</span>
          <input {...register("travelArea")} />
          <small>{errors.travelArea?.message}</small>
        </label>
        <label className="form-span">
          Deliverables (comma separated){" "}
          <span className="required-mark">Required</span>
          <input {...register("deliverables")} />
          <small>{errors.deliverables?.message}</small>
        </label>
        <label className="form-span">
          Terms <span className="required-mark">Required</span>
          <textarea {...register("terms")} rows={3} />
          <small>{errors.terms?.message}</small>
        </label>
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="button button-dark" disabled={isSubmitting} type="submit">{isSubmitting ? <LoaderCircle className="spin" size={16} /> : null}Create package</button>
    </form>
  );
}
