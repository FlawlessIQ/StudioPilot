"use client";

import { useEffect, useMemo, useState } from "react";
import { Printer } from "lucide-react";
import { doc, onSnapshot } from "firebase/firestore";
import { QrImage, eventSignupUrl } from "@/components/group-events/event-signup-panel";
import { useWorkspace } from "@/features/auth/workspace-context";
import { EVENT_PAYMENT_SHORT, eventPrice, normaliseEventSignup } from "@/features/group-events/signup";
import { getFirebaseClient } from "@/lib/firebase/client";
import { dataIsLive } from "@/lib/runtime-mode";

/**
 * A sign for the field: the QR code, the packages and how to pay, printed
 * on one page (docs/group-event-signup-plan-2026-10-10.md, Phase 2). Only
 * the sign prints; the app around it doesn't.
 */
export function EventSign({ projectId }: { projectId: string }) {
  const workspace = useWorkspace();
  const [project, setProject] = useState<{ name?: unknown; eventDate?: unknown; groupEvent?: unknown } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!dataIsLive) return;
    return onSnapshot(
      doc(getFirebaseClient().firestore, "projects", projectId),
      (snapshot) => setProject(snapshot.exists() ? (snapshot.data() as typeof project) : null),
      () => setError("This job couldn't be loaded."),
    );
  }, [projectId]);

  const config = useMemo(() => normaliseEventSignup(project?.groupEvent), [project?.groupEvent]);
  const name = typeof project?.name === "string" ? project.name : "";
  const date =
    typeof project?.eventDate === "string" && /^\d{4}-\d{2}-\d{2}/.test(project.eventDate)
      ? new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(
          new Date(`${project.eventDate.slice(0, 10)}T12:00:00Z`),
        )
      : null;

  if (error) return <p className="form-error">{error}</p>;
  if (!config.token) {
    return <p className="form-notice">Set up sign-up on the job first, then print the sign.</p>;
  }
  const url = eventSignupUrl(config.token);
  return (
    <div className="event-sign-page">
      <div className="event-sign-actions">
        <button className="button button-dark" onClick={() => window.print()} type="button">
          <Printer aria-hidden size={16} /> Print
        </button>
      </div>
      <article className="event-sign">
        <p className="event-sign-studio">{workspace.tenantName}</p>
        <h1>Scan to sign up</h1>
        <p className="event-sign-event">
          {name}
          {date ? ` · ${date}` : ""}
        </p>
        <QrImage label={`QR code for ${url}`} url={url} />
        <ul className="event-sign-options">
          {config.options.map((option) => (
            <li key={option.id}>
              <span>
                <strong>{option.name}</strong>
                {option.description ? <small>{option.description}</small> : null}
              </span>
              <strong>{eventPrice(option.priceCents)}</strong>
            </li>
          ))}
        </ul>
        <p className="event-sign-pay">Pay by {config.methods.map((method) => EVENT_PAYMENT_SHORT[method]).join(", ")}</p>
        <p className="event-sign-url">{url.replace(/^https?:\/\//, "")}</p>
      </article>
    </div>
  );
}
