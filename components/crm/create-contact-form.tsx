"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, LoaderCircle } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { runCrmCommand } from "@/lib/crm/command-client";

const schema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().email(),
  phone: z.string().trim().max(30),
  company: z.string().trim().max(160),
});
type FormValues = z.infer<typeof schema>;

export function CreateContactForm() {
  const [outcome, setOutcome] = useState<{ persisted: boolean; reference: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { firstName: "", lastName: "", email: "", phone: "", company: "" },
  });

  const submit = handleSubmit(async (values) => {
    setError(null);
    try {
      const command = await runCrmCommand("createContact", {
        ...values,
        phone: values.phone || null,
        company: values.company || null,
        contactTypes: ["client"],
      });
      setOutcome({
        persisted: command.persisted,
        reference: String(command.result.contactId ?? command.result.reference),
      });
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Contact could not be created.");
    }
  });

  if (outcome) {
    return <div className="command-success"><CheckCircle2 size={23} /><h2>Client prepared</h2><p>Reference: {outcome.reference}</p>{!outcome.persisted ? <small>Preview mode: this record was not persisted.</small> : null}</div>;
  }

  return (
    <form className="command-form panel" onSubmit={submit}>
      <div className="form-grid">
        <label>First name<input {...register("firstName")} /><small>{errors.firstName?.message}</small></label>
        <label>Last name<input {...register("lastName")} /><small>{errors.lastName?.message}</small></label>
        <label>Email<input {...register("email")} type="email" /><small>{errors.email?.message}</small></label>
        <label>Phone<input {...register("phone")} type="tel" /></label>
        <label className="form-span">Company<input {...register("company")} /></label>
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="button button-dark" disabled={isSubmitting} type="submit">{isSubmitting ? <LoaderCircle className="spin" size={16} /> : null}Create client</button>
    </form>
  );
}
