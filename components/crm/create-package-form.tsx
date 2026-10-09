"use client";

import {
  billedRolesFrom,
  coverageFrom,
} from "@/components/crm/package-coverage-fields";
import { useEffect, useState } from "react";
import { perCrewRetainerProblem } from "@/features/packages/retainer-check";
import { examplePackagesFor, type ExamplePackage } from "@/features/job-kinds/example-packages";
import { COVERAGE_ROLES, coverageRoleLabel, type CoverageRole } from "@/features/packages/coverage";
import { useWorkspace } from "@/features/auth/workspace-context";
import { tradeOf, tradeProfile, tradeVocab } from "@/features/trades/trades";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, CheckCircle2, LoaderCircle } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { friendlyError } from "@/lib/ai/friendly-error";
import { PackageAddOnPicker } from "@/components/crm/package-add-on-picker";
import { runCrmCommand } from "@/lib/crm/command-client";
import { InfoHint } from "@/components/ui/info-hint";
import {
  JOB_KIND_LABELS,
  JOB_KINDS,
  journeyProfile,
  PAYMENT_SHAPE_LABELS,
  PAYMENT_SHAPES,
} from "@/features/job-kinds/job-kinds";

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
      .min(2, "Give the package a name clients will recognize.")
      .max(120, "Keep the name under 120 characters."),
    description: z
      .string()
      .trim()
      .min(10, "A sentence or two on what this package includes.")
      .max(3000, "Keep the description under 3,000 characters."),
    // A kind of job (job-kinds.ts): packages are offered to jobs of their kind.
    eventType: z.enum(JOB_KINDS),
    paymentShape: z.enum(PAYMENT_SHAPES),
    basePrice: z.coerce
      .number()
      .positive("Set a price above zero."),
    retainerMode: z.enum(["percentage", "fixed", "per_crew_member"]),
    retainerAmount: z.coerce
      .number()
      .min(0, "A retainer cannot be negative."),
    coverageHours: z.coerce
      .number()
      // Read by every trade's studio, so in words a DJ or a stylist uses too.
      .positive("How many hours this package includes."),
    photographers: z.coerce
      .number()
      .int("Whole people only.")
      .min(0, "A count cannot be negative."),
    videographers: z.coerce
      .number()
      .int("Whole people only.")
      .min(0, "A count cannot be negative."),
    /** Which roles a per-crew-member retainer charges for. */
    billPhotographers: z.boolean(),
    billVideographers: z.boolean(),
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
    // A package has to send somebody. Either count may be zero — a video-only
    // package sends no photographer — but not both.
    if (values.photographers + values.videographers < 1) {
      context.addIssue({
        code: "custom",
        path: ["photographers"],
        message: "A package includes at least one person.",
      });
    }
    if (
      values.retainerMode === "per_crew_member" &&
      !values.billPhotographers &&
      !values.billVideographers
    ) {
      context.addIssue({
        code: "custom",
        path: ["billPhotographers"],
        message: "Choose at least one role the retainer charges for.",
      });
    }
    // Charging per photographer on a package with none counts nobody (retainer-check.ts).
    const nobody =
      values.retainerMode === "per_crew_member" && values.paymentShape === "deposit_and_balance"
        ? perCrewRetainerProblem({
            coverage: coverageFrom({ photographers: values.photographers, videographers: values.videographers }),
            billedRoles: billedRolesFrom(values),
          })
        : null;
    if (nobody) context.addIssue({ code: "custom", path: ["billPhotographers"], message: nobody });
  });
type FormInput = z.input<typeof schema>;
type FormValues = z.output<typeof schema>;

/** A vendor trade's starting hours and what's included, in place of a photographer's. */
const VENDOR_DEFAULTS: Partial<Record<string, { hours: number; included: string }>> = {
  dj: { hours: 5, included: "Reception sound, Dance floor lighting, MC" },
  makeup: { hours: 2, included: "Bridal makeup, Lashes, Touch-up kit" },
  hair: { hours: 2, included: "Bridal hair, Veil placement" },
};

export function CreatePackageForm({
  returnTo = null,
}: {
  /** A /studio/… path to return to after creating (e.g. a proposal flow). */
  returnTo?: string | null;
} = {}) {
  const router = useRouter();
  // The studio's own crew roles (trades.ts): a photographer's photographers
  // and videographers, a DJ's DJs. The form's two counts are these.
  const trade = useWorkspace().tenantTrade;
  const roles = tradeProfile(trade).coverageRoles as readonly CoverageRole[];
  const [outcome, setOutcome] = useState<{
    persisted: boolean;
    name: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addOnIds, setAddOnIds] = useState<string[]>([]);
  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } = useForm<FormInput, unknown, FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", description: "", eventType: "wedding", paymentShape: "deposit_and_balance", basePrice: 0, retainerMode: "percentage", retainerAmount: 30, coverageHours: roles[0] === "dj" ? 5 : 8, photographers: roles[0] === "dj" ? 1 : 2, videographers: 0, billPhotographers: true, billVideographers: true, deliverables: roles[0] === "dj" ? "Reception sound, Dance floor lighting, MC" : "Online gallery, High-resolution downloads", travelArea: "Within 50 miles", terms: "Subject to the completed studio agreement." },
  });
  // The workspace (and so the trade) loads after the form's defaults are
  // taken: a DJ's start as one DJ, five hours and what a DJ includes, a makeup
  // artist's or hair stylist's as one artist on site for two hours, not a
  // photographer's two photographers and a gallery. Only while untouched.
  const tradeId = tradeOf(trade);
  const photoStudio = tradeId === "photographer";
  // "Coverage hours" and "Deliverables" are a photographer's words: a DJ's
  // "Hours of music", an artist's "Hours on site", and "What's included".
  const words = tradeVocab(trade);
  const ownDefaults = VENDOR_DEFAULTS[tradeId];
  useEffect(() => {
    if (!ownDefaults) return;
    if (watch("deliverables") === "Online gallery, High-resolution downloads") setValue("deliverables", ownDefaults.included);
    if (Number(watch("coverageHours")) === 8) setValue("coverageHours", ownDefaults.hours);
    if (Number(watch("photographers")) === 2) setValue("photographers", 1);
  }, [ownDefaults, setValue, watch]);
  const retainerMode = watch("retainerMode");
  const kind = watch("eventType");
  /** An example's shape, never its price: the studio sets that (example-packages.ts). */
  function startFrom(example: ExamplePackage) {
    setValue("name", example.name);
    setValue("description", example.description);
    setValue("coverageHours", example.coverageHours);
    setValue("photographers", example.photographers);
    setValue("videographers", example.videographers);
    setValue("deliverables", example.deliverables);
    setValue("terms", journeyProfile(kind).agreement ? "Subject to the completed studio agreement." : "Subject to the studio's terms.");
  }
  const paymentShape = watch("paymentShape");
  // Only a deposit has a retainer to set: paid in full takes the whole price
  // to book, and "on the day" or "invoiced after" take nothing up front.
  const hasDeposit = paymentShape === "deposit_and_balance";
  const submit = handleSubmit(async (values) => {
    setError(null);
    try {
      const command = await runCrmCommand("createPackage", {
        name: values.name,
        description: values.description,
        eventTypeId: values.eventType,
        eventTypeLabel: JOB_KIND_LABELS[values.eventType],
        paymentShape: values.paymentShape,
        basePriceCents: Math.round(values.basePrice * 100),
        currency: "USD",
        retainerRule:
          values.paymentShape === "paid_in_full"
            ? { type: "percentage" as const, basisPoints: 10000 }
            : values.paymentShape !== "deposit_and_balance"
              ? { type: "fixed" as const, amountCents: 0 }
              : values.retainerMode === "percentage"
            ? { type: "percentage" as const, basisPoints: Math.round(values.retainerAmount * 100) }
            : values.retainerMode === "fixed"
              ? { type: "fixed" as const, amountCents: Math.round(values.retainerAmount * 100) }
              : {
                  type: "per_crew_member" as const,
                  amountPerCrewCents: Math.round(values.retainerAmount * 100),
                  billedRoles: billedRolesFrom(values, roles),
                },
        includedCoverageMinutes: Math.round(values.coverageHours * 60),
        includedCoverage: coverageFrom(values, roles),
        includedDeliverables: values.deliverables.split(",").map((item) => item.trim()).filter(Boolean),
        includedTravelArea: values.travelArea,
        addOns: [],
        // The chosen library add-ons; the server copies them onto the package.
        addOnIds,
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
        <p>{`Clients can now be offered this package in ${tradeVocab(trade).proposal.toLowerCase()}s.`}</p>
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
          Kind of job <span className="required-mark">Required</span>
          <select
            {...register("eventType", {
              // Each kind has its usual way of being paid; the studio can change it.
              onChange: (event) =>
                setValue("paymentShape", journeyProfile(event.target.value).payment),
            })}
          >
            {JOB_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {JOB_KIND_LABELS[kind]}
              </option>
            ))}
          </select>
          <small>{errors.eventType?.message}</small>
        </label>
        <label>
          How it&rsquo;s paid <span className="required-mark">Required</span>
          <select {...register("paymentShape")}>
            {PAYMENT_SHAPES.map((shape) => (
              <option key={shape} value={shape}>
                {PAYMENT_SHAPE_LABELS[shape]}
              </option>
            ))}
          </select>
        </label>
        {/* After the kind it follows: the examples change with it. */}
        <div className="form-span package-examples" role="group" aria-label="Start from an example">
          <span>Start from an example</span>
          {examplePackagesFor(tradeOf(trade), kind).map((example) => (
            <button className="schedule-moment-chip" key={example.name} onClick={() => startFrom(example)} type="button">
              {example.name}
            </button>
          ))}
          <small>Fills in the shape. The price is always yours to set.</small>
        </div>
        <label>
          Base price (USD) <span className="required-mark">Required</span>
          <input {...register("basePrice")} min="0.01" step="0.01" type="number" />
          <small>{errors.basePrice?.message}</small>
        </label>
        {hasDeposit ? (
        <>
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
        {retainerMode === "per_crew_member" ? (
          <>
            <label className="form-checkbox">
              <input {...register("billPhotographers")} type="checkbox" />
              <span>{`Charge this per ${coverageRoleLabel(roles[0] ?? COVERAGE_ROLES[0]!, 1)}`}</span>
              <small>{errors.billPhotographers?.message}</small>
            </label>
            {roles[1] ? (
              <label className="form-checkbox">
                <input {...register("billVideographers")} type="checkbox" />
                <span>{`Charge this per ${coverageRoleLabel(roles[1], 1)}`}</span>
              </label>
            ) : null}
          </>
        ) : null}
        </>
        ) : null}
        <label>
          {words.hoursLabel}{" "}
          <span className="required-mark">Required</span>
          <input {...register("coverageHours")} min="0.5" step="0.5" type="number" />
          <small>{errors.coverageHours?.message}</small>
        </label>
        {/*
          Neither count is required on its own — the pair is. Marking
          Photographers "Required" and leaving Videographers bare told a
          video-led studio that this product thinks in photographers, and left
          them zeroing out a field the schema never needed. The rule the form
          actually enforces is in the superRefine above: at least one person.
        */}
        <label>
          {roleHeading(roles[0])}
          <input {...register("photographers")} min="0" type="number" />
          <small>{errors.photographers?.message}</small>
        </label>
        {roles[1] ? (
          <label>
            {roleHeading(roles[1])}
            <input {...register("videographers")} min="0" type="number" />
            <small>{errors.videographers?.message}</small>
          </label>
        ) : null}
        <p className="field-hint form-span">
          {roles[1] ? "Who your studio sends. At least one, in either row." : "Who your studio sends. At least one."}{" "}
          {/* The glossary's "Coverage" is a photographer's: photographers, videographers and hours. */}
          {photoStudio ? (
            <InfoHint term="coverage" />
          ) : (
            <InfoHint label={words.coverage}>
              {`Who you send and for how long: your ${words.crew} and their hours. It fills your contract and can set a per-crew retainer.`}
            </InfoHint>
          )}
        </p>
        <label>
          Travel area <span className="required-mark">Required</span>
          <input {...register("travelArea")} />
          <small>{errors.travelArea?.message}</small>
        </label>
        <label className="form-span">
          {`${words.includedLabel} (comma separated)`}{" "}
          <span className="required-mark">Required</span>
          <input {...register("deliverables")} />
          <small>{errors.deliverables?.message}</small>
        </label>
        <label className="form-span">
          Terms <span className="required-mark">Required</span>
          <textarea {...register("terms")} rows={3} />
          <small>{errors.terms?.message}</small>
        </label>
        <PackageAddOnPicker currency="USD" onChange={setAddOnIds} value={addOnIds} />
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="button button-dark" disabled={isSubmitting} type="submit">{isSubmitting ? <LoaderCircle className="spin" size={16} /> : null}Create package</button>
    </form>
  );
}

/** "Photographers", "DJs": a count's heading. */
function roleHeading(role: CoverageRole | undefined): string {
  const label = coverageRoleLabel(role ?? COVERAGE_ROLES[0]!, 2);
  return label.charAt(0).toUpperCase() + label.slice(1);
}
