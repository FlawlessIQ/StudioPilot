"use client";

import { useCallback, useState } from "react";
import { CONSOLE_ROLES, CONSOLE_ROLE_LABELS, CONSOLE_ROLE_SUMMARIES } from "@/features/console/roles";
import type { ConsolePerson } from "@/features/console/model";
import { useConsole } from "./console-context";
import type { MenuItem } from "./menu";
import { ConfirmDialog } from "./overlay";
import { useCommand } from "./use-command";

/**
 * Account actions on a person. Each is something the person could do
 * themselves ("Forgot password"), done for them, or a protective step
 * (sign out everywhere, disable). All audited.
 */
type Kind = "reset" | "verify" | "revoke" | "disable" | "enable" | "role";

export function usePeopleActions() {
  const { can, role, user } = useConsole();
  const [state, setState] = useState<{ kind: Kind; person: ConsolePerson } | null>(null);
  const menuItems = useCallback(
    (person: ConsolePerson): MenuItem[] => {
      const self = person.uid === user?.uid;
      const items: MenuItem[] = [];
      if (can("people.support") && person.email) {
        items.push({ label: "Send password reset…", onSelect: () => setState({ kind: "reset", person }) });
        if (!person.emailVerified) items.push({ label: "Resend verification email…", onSelect: () => setState({ kind: "verify", person }) });
      }
      if (can("people.manage") && !self) {
        items.push({ kind: "separator" });
        items.push({ label: "Sign out everywhere…", onSelect: () => setState({ kind: "revoke", person }) });
        items.push(
          person.disabled
            ? { label: "Enable account…", onSelect: () => setState({ kind: "enable", person }) }
            : { label: "Disable account…", danger: true, onSelect: () => setState({ kind: "disable", person }) },
        );
      }
      if (role === "owner" && !self) {
        items.push({ kind: "separator" });
        items.push({ label: person.consoleRole ? "Change Console role…" : "Give Console access…", onSelect: () => setState({ kind: "role", person }) });
      }
      return items;
    },
    [can, role, user?.uid],
  );
  return { state, setState, menuItems };
}

export function PeopleDialogs({ actions }: { actions: ReturnType<typeof usePeopleActions> }) {
  const { run, busy } = useCommand();
  const [consoleRole, setConsoleRole] = useState<string>("support");
  const state = actions.state;
  if (!state) return null;
  const { person, kind } = state;
  const close = () => actions.setState(null);
  const who = person.name ?? person.email ?? "this person";

  if (kind === "reset" || kind === "verify") {
    return (
      <ConfirmDialog
        busy={Boolean(busy)}
        confirmLabel="Send email"
        description={
          kind === "reset"
            ? `Emails ${who} <${person.email}> a link to choose a new password, exactly as "Forgot password" does. Their current password keeps working until they change it.`
            : `Emails ${who} <${person.email}> a new link to verify their address.`
        }
        onClose={close}
        onConfirm={async () => {
          const result = await run(kind === "reset" ? "sendPasswordReset" : "resendVerification", { uid: person.uid }, { done: `Email sent to ${person.email}.` });
          if (result) close();
        }}
        open
        requireReason={false}
        title={kind === "reset" ? "Send password reset" : "Resend verification"}
      />
    );
  }
  if (kind === "revoke") {
    return (
      <ConfirmDialog
        busy={Boolean(busy)}
        confirmLabel="Sign out everywhere"
        description={`${who} is signed out on every device and has to sign in again. Use this for a lost phone or a shared password.`}
        onClose={close}
        onConfirm={async ({ reason }) => {
          const result = await run("revokeSessions", { uid: person.uid, reason }, { done: `${who} is signed out everywhere.` });
          if (result) close();
        }}
        open
        title="Sign out everywhere"
      />
    );
  }
  if (kind === "disable" || kind === "enable") {
    const disabling = kind === "disable";
    return (
      <ConfirmDialog
        busy={Boolean(busy)}
        confirmLabel={disabling ? "Disable account" : "Enable account"}
        danger={disabling}
        description={
          disabling
            ? `${who} can't sign in until the account is enabled again, and is signed out now. Their studios and records are untouched.`
            : `${who} can sign in again.`
        }
        onClose={close}
        onConfirm={async ({ reason }) => {
          const result = await run("setPersonDisabled", { uid: person.uid, disabled: disabling, reason }, { done: disabling ? `${who} is disabled.` : `${who} is enabled.` });
          if (result) close();
        }}
        open
        title={disabling ? "Disable account" : "Enable account"}
      />
    );
  }
  return (
    <ConfirmDialog
      busy={Boolean(busy)}
      confirmLabel={consoleRole === "none" ? "Remove access" : "Save role"}
      danger={consoleRole === "none"}
      description={`Changes what ${who} can do in the StudioCue Console. They're signed out so the change applies at once.`}
      onClose={close}
      onConfirm={async ({ reason }) => {
        const result = await run("setConsoleRole", { uid: person.uid, role: consoleRole, reason }, { done: consoleRole === "none" ? `${who} no longer has Console access.` : `${who} is now ${CONSOLE_ROLE_LABELS[consoleRole as keyof typeof CONSOLE_ROLE_LABELS]}.` });
        if (result) close();
      }}
      open
      title="Console role"
    >
      <div className="cx-checks">
        {[...CONSOLE_ROLES, "none" as const].map((option) => (
          <label className="cx-check" key={option} style={{ alignItems: "flex-start" }}>
            <input checked={consoleRole === option} name="console-role" onChange={() => setConsoleRole(option)} type="radio" />
            <span>
              <b>{option === "none" ? "No Console access" : CONSOLE_ROLE_LABELS[option]}</b>
              <br />
              <span className="cx-hint">{option === "none" ? "Removes the platform admin claim." : CONSOLE_ROLE_SUMMARIES[option]}</span>
            </span>
          </label>
        ))}
      </div>
    </ConfirmDialog>
  );
}
