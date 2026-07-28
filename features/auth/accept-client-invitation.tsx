"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { onAuthStateChanged } from "firebase/auth";
import { CheckCircle2, LoaderCircle, ShieldCheck } from "lucide-react";
import { runClientInvitation } from "@/lib/client/invitation-client";
import { getFirebaseClient } from "@/lib/firebase/client";
import { authIsLive } from "@/lib/runtime-mode";

export function AcceptClientInvitation({ token }: { token: string }) {
  const [signedIn, setSignedIn] = useState(!authIsLive);
  const [verified, setVerified] = useState(!authIsLive);
  const [state, setState] = useState<"idle" | "submitting" | "accepted" | "error">("idle");
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!authIsLive) return;
    return onAuthStateChanged(getFirebaseClient().auth, (user) => {
      setSignedIn(Boolean(user));
      setVerified(Boolean(user?.emailVerified));
    });
  }, []);
  const next = `/auth/client-invite?token=${encodeURIComponent(token)}`;
  if (!signedIn)
    return (
      <div className="invite-actions">
        <p>Sign in with the exact email address used for your photography project.</p>
        <Link className="button button-dark" href={`/auth/login?next=${encodeURIComponent(next)}`}>Sign in to continue</Link>
        <Link href={`/auth/register?next=${encodeURIComponent(next)}`}>Create an account with the invited email</Link>
      </div>
    );
  if (!verified)
    return <div className="invite-actions"><ShieldCheck /><p>Verify your email before activating the client portal.</p></div>;
  if (state === "accepted")
    return <div className="invite-actions"><CheckCircle2 /><p>{message}</p><Link className="button button-dark" href="/client">Open client portal</Link></div>;
  async function accept() {
    setState("submitting");
    try {
      await runClientInvitation({
        type: "accept",
        idempotencyKey: crypto.randomUUID(),
        input: { token },
      });
      setMessage("Your project portal is active.");
      setState("accepted");
    } catch (caught: unknown) {
      setMessage(caught instanceof Error ? caught.message : "Activation failed.");
      setState("error");
    }
  }
  return (
    <div className="invite-actions">
      <ShieldCheck />
      <p>This activates access only to the project named in the invitation. The link expires after seven days.</p>
      <button className="button button-dark" disabled={state === "submitting" || token.length < 32} onClick={() => void accept()} type="button">
        {state === "submitting" ? <LoaderCircle className="spin" /> : <ShieldCheck />} Activate secure portal
      </button>
      {message ? <p className="form-error" role="status">{message}</p> : null}
    </div>
  );
}
