"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, LoaderCircle, MessageSquareReply } from "lucide-react";
import { useWorkspace } from "@/features/auth/workspace-context";
import {
  FIRST_REPLY_INSTRUCTIONS_LIMIT,
  FIRST_REPLY_PLACEHOLDER,
} from "@/features/settings/first-reply";
import {
  getFirstReplyInstructions,
  setFirstReplyInstructions,
} from "@/lib/ai/copilot-client";
import { friendlyError } from "@/lib/ai/friendly-error";
import { settingsSectionHref } from "@/features/settings/sections";

/**
 * "How your first reply should go" — Settings → Communications.
 *
 * A new inquiry gets two emails, and studios could not tell them apart. The
 * automatic "we got your inquiry" one goes straight away and its words are an
 * email template. The personal first reply is drafted by Cue for the studio
 * to approve, and until now nothing the studio said shaped it. GR Productions,
 * 2026-10-01, wanted it to always thank the couple, say they're a
 * husband-and-wife team, and invite them to call. This is where that goes;
 * the drafter reads it as the studio's quoted preferences, beside the voice
 * set in "Teach Cue your voice" (functions/src/ai/studio-voice.ts).
 *
 * Owner or admin, as the command is.
 */
export function FirstReplySettings() {
  const workspace = useWorkspace();
  const canEdit =
    workspace.role === "studio_owner" || workspace.role === "studio_admin";
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const touched = useRef(false);

  const load = useCallback(() => {
    if (!canEdit || !workspace.tenantId) return;
    void getFirstReplyInstructions(workspace.tenantId)
      .then((stored) => {
        if (!touched.current) setValue(stored ?? "");
      })
      .catch(() => {
        /* the field still works; a save reports its own failure */
      });
  }, [canEdit, workspace.tenantId]);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    if (!workspace.tenantId) return;
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      const stored = await setFirstReplyInstructions(workspace.tenantId, value);
      touched.current = false;
      setValue(stored ?? "");
      setSaved(true);
    } catch (caught: unknown) {
      setError(friendlyError(caught, "That could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel first-reply-settings" aria-labelledby="first-reply-settings-title">
      <form
        className="crm-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="email-branding-heading">
          <span className="data-control-icon">
            <MessageSquareReply aria-hidden="true" />
          </span>
          <div>
            <p className="eyebrow">Communications</p>
            <h2 id="first-reply-settings-title">How your first reply should go</h2>
            <p>When a new inquiry arrives, the couple hears from you twice.</p>
          </div>
        </div>
        <ol className="first-reply-two-emails">
          <li>
            <strong>The automatic &ldquo;we got your inquiry&rdquo; email.</strong>{" "}
            It goes right away, before you&rsquo;ve seen the inquiry. You can
            change its words under{" "}
            <Link href={settingsSectionHref("templates")}>Email templates</Link>{" "}
            — pick &ldquo;Inquiry received&rdquo;.
          </li>
          <li>
            <strong>Your personal first reply.</strong>{" "}
            Cue drafts it for you to
            read and approve on Today; nothing goes until you send it. It follows
            what you write below, and the tone and sign-off you set in{" "}
            <Link href="/studio/copilot">Teach Cue your voice</Link>. Rather
            write it yourself? Save your own under{" "}
            <Link href="/studio/settings/templates?email=inquiry_reply">Email templates — Your reply to a new inquiry</Link>{" "}
            and every reply starts from your words, with their name and details filled in.
          </li>
        </ol>
        {canEdit ? (
          <>
            <label className="first-reply-field">
              What should your first reply always do?
              <textarea
                disabled={busy}
                maxLength={FIRST_REPLY_INSTRUCTIONS_LIMIT}
                onChange={(event) => {
                  touched.current = true;
                  setValue(event.target.value);
                  setSaved(false);
                }}
                placeholder={FIRST_REPLY_PLACEHOLDER}
                rows={4}
                value={value}
              />
              <small>
                {`Plain words are fine. Cue still never makes up prices, dates or availability, whatever this says. ${value.length}/${FIRST_REPLY_INSTRUCTIONS_LIMIT}`}
              </small>
            </label>
            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : null}
            {saved ? (
              <p className="form-notice" role="status">
                <CheckCircle2 size={15} /> Saved. Your next first reply follows it.
              </p>
            ) : null}
            <button className="button button-dark" disabled={busy} type="submit">
              {busy ? <LoaderCircle className="spin" size={16} /> : null}
              Save
            </button>
          </>
        ) : (
          <p className="form-notice">
            Only the studio owner or an admin can change how your first reply goes.
          </p>
        )}
      </form>
    </section>
  );
}
