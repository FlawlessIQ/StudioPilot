"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  collection,
  getDocs,
  limit,
  query,
  where,
} from "firebase/firestore";
import { Check, Clipboard, LoaderCircle, ShieldCheck, UserPlus } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  useWorkspace,
  workspaceRoleLabel,
} from "@/features/auth/workspace-context";
import { getFirebaseClient } from "@/lib/firebase/client";
import { runMembershipCommand } from "@/lib/memberships/command-client";
import { dataIsLive } from "@/lib/runtime-mode";
import { formatDueDate } from "@/lib/format/event-date";
import { friendlyError } from "@/lib/ai/friendly-error";
import {
  ASSIGNABLE_ROLES,
  ROLE_SUMMARY,
  type AssignableRole,
} from "@/features/team/role-summaries";

type MemberRow = {
  id: string;
  displayName: string;
  email: string;
  role: string;
  status: string;
};
type InvitationRow = {
  id: string;
  displayName: string;
  email: string;
  role: string;
  expiresAt: string;
};

export function TeamManagement() {
  const workspace = useWorkspace();
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [invitations, setInvitations] = useState<InvitationRow[]>([]);
  const [loading, setLoading] = useState(dataIsLive);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteRole, setInviteRole] = useState<AssignableRole>("studio_coordinator");
  /** A suspend or remove waiting on "yes": the member and what was asked. */
  const [confirming, setConfirming] = useState<{
    id: string;
    action: "suspend" | "remove";
  } | null>(null);

  const load = useCallback(async () => {
    if (!dataIsLive || !workspace.tenantId || workspace.role !== "studio_owner")
      return;
    try {
      const { firestore } = getFirebaseClient();
      const [membershipSnapshot, invitationSnapshot] = await Promise.all([
        getDocs(
          query(
            collection(firestore, "memberships"),
            where("tenantId", "==", workspace.tenantId),
            limit(100),
          ),
        ),
        getDocs(
          query(
            collection(firestore, "tenantInvitations"),
            where("tenantId", "==", workspace.tenantId),
            limit(100),
          ),
        ),
      ]);
      setMembers(
        membershipSnapshot.docs
          .map((document) => {
            const value = document.data();
            return {
              id: document.id,
              displayName: String(
                value.displayName ??
                  (value.userId === workspace.userId
                    ? workspace.userName
                    : "Team member"),
              ),
              email: String(
                value.email ??
                  (value.userId === workspace.userId
                    ? workspace.userEmail
                    : "Email available after next sign-in"),
              ),
              role: String(value.role),
              status: String(value.status),
            };
          })
          // Studio staff only. Clients with portal access and crew with an
          // account are memberships too; they belong on the Clients and Crew
          // tabs, and listed here they showed as "Studio Admin" (the picker's
          // first option) with a role picker that could promote them.
          .filter(
            (member) =>
              member.status !== "revoked" &&
              (member.role === "studio_owner" ||
                (ASSIGNABLE_ROLES as readonly string[]).includes(member.role)),
          ),
      );
      setInvitations(
        invitationSnapshot.docs
          .filter((document) => document.get("status") === "pending")
          .map((document) => ({
            id: document.id,
            displayName: String(document.get("displayName")),
            email: String(document.get("email")),
            role: String(document.get("role")),
            expiresAt: String(document.get("expiresAt")),
          })),
      );
      setNotice(null);
    } catch (caught: unknown) {
      setNotice(
        friendlyError(caught, "Team access could not load."),
      );
    } finally {
      setLoading(false);
    }
  }, [
    workspace.role,
    workspace.tenantId,
    workspace.userEmail,
    workspace.userId,
    workspace.userName,
  ]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace.tenantId) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy("invite");
    setNotice(null);
    setInviteUrl(null);
    try {
      const result = await runMembershipCommand({
        type: "inviteMember",
        tenantId: workspace.tenantId,
        input: {
          displayName: String(data.get("displayName")),
          email: String(data.get("email")),
          role: String(data.get("role")),
        },
      });
      const sharedUrl =
        typeof result.inviteUrl === "string" ? result.inviteUrl : null;
      setInviteUrl(sharedUrl);
      setNotice(
        `Invitation sent to ${String(data.get("email"))}. The link below works too, if you'd rather send it yourself.`,
      );
      form.reset();
      await load();
    } catch (caught: unknown) {
      setNotice(
        friendlyError(caught, "Invitation failed."),
      );
    } finally {
      setBusy(null);
    }
  }

  async function revokeInvitation(invitationId: string) {
    if (!workspace.tenantId) return;
    setBusy(invitationId);
    try {
      await runMembershipCommand({
        type: "revokeInvitation",
        tenantId: workspace.tenantId,
        input: { invitationId },
      });
      setNotice("Invitation cancelled. The link no longer works.");
      await load();
    } catch (caught: unknown) {
      setNotice(
        friendlyError(caught, "Revocation failed."),
      );
    } finally {
      setBusy(null);
    }
  }

  async function updateMember(
    membershipId: string,
    update: { role?: string; status?: string },
  ) {
    if (!workspace.tenantId) return;
    const member = members.find((item) => item.id === membershipId);
    setConfirming(null);
    setBusy(membershipId);
    try {
      await runMembershipCommand({
        type: "updateMember",
        tenantId: workspace.tenantId,
        input: {
          membershipId,
          ...update,
          reason: "Studio Owner updated workspace access from Team settings.",
        },
      });
      const name = member?.displayName ?? "They";
      setNotice(
        update.role
          ? `${name} is now ${workspaceRoleLabel(update.role)}.`
          : update.status === "suspended"
            ? `${name} is suspended and can't sign in until you reactivate them.`
            : update.status === "revoked"
              ? `${name} no longer has access to this studio.`
              : `${name} can sign in again.`,
      );
      await load();
    } catch (caught: unknown) {
      setNotice(
        friendlyError(caught, "Member update failed."),
      );
    } finally {
      setBusy(null);
    }
  }

  if (workspace.loading || loading) {
    return (
      <section className="panel team-state">
        <LoaderCircle className="spin" />
        <span>
          <strong>Loading team access…</strong>
          <small>Loading team members and pending invitations.</small>
        </span>
      </section>
    );
  }
  if (workspace.role !== "studio_owner") {
    return (
      <section className="panel team-state">
        <ShieldCheck />
        <span>
          <strong>Only the studio owner can manage the team</strong>
          <small>
            Ask them to invite people or change what someone can do.
          </small>
        </span>
      </section>
    );
  }

  const initials = (name: string) =>
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("");

  return (
    <div className="team-management">
      <section className="panel team-invite-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Invite</p>
            <h2>Add someone to your studio</h2>
            <p>They&apos;ll get an email with a link to join. Choose what they can do.</p>
          </div>
        </div>
        <form className="team-invite-form" onSubmit={(event) => void invite(event)}>
          <label>
            Name
            <input autoComplete="off" name="displayName" required minLength={2} />
          </label>
          <label>
            Email
            <input autoComplete="off" name="email" required type="email" />
          </label>
          <label>
            Role
            <select
              name="role"
              onChange={(event) => setInviteRole(event.target.value as AssignableRole)}
              value={inviteRole}
            >
              {ASSIGNABLE_ROLES.map((role) => (
                <option key={role} value={role}>
                  {workspaceRoleLabel(role)}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button button-dark"
            disabled={busy === "invite"}
            type="submit"
          >
            {busy === "invite" ? <LoaderCircle className="spin" /> : <UserPlus />}
            Send invitation
          </button>
          <p className="team-role-hint">{ROLE_SUMMARY[inviteRole]}</p>
        </form>
        {inviteUrl ? (
          <div className="team-invite-link">
            <Check />
            <span>
              <strong>Invitation link</strong>
              <small>{inviteUrl}</small>
            </span>
            <button
              type="button"
              onClick={() => void navigator.clipboard.writeText(inviteUrl)}
            >
              <Clipboard size={15} /> Copy link
            </button>
          </div>
        ) : null}
      </section>

      {invitations.length ? (
        <section className="panel team-people">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Waiting to join</p>
              <h2>Invitations</h2>
            </div>
          </div>
          {invitations.map((invitation) => (
            <article className="team-person" key={invitation.id}>
              <span className="team-avatar is-pending">{initials(invitation.displayName)}</span>
              <span className="team-person-name">
                <strong>{invitation.displayName}</strong>
                <small>{invitation.email}</small>
              </span>
              <span className="team-person-role">
                <strong>{workspaceRoleLabel(invitation.role)}</strong>
                <small>Link expires {formatDueDate(invitation.expiresAt)}</small>
              </span>
              <span className="team-person-actions">
                <StatusBadge tone="warning">Invited</StatusBadge>
                <button
                  className="button button-light"
                  disabled={busy === invitation.id}
                  onClick={() => void revokeInvitation(invitation.id)}
                  type="button"
                >
                  Cancel invitation
                </button>
              </span>
            </article>
          ))}
        </section>
      ) : null}

      <section className="panel team-people">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Your team</p>
            <h2>Team members</h2>
            <p>Everyone who can sign in to this studio.</p>
          </div>
        </div>
        {members.map((member) => {
          const isOwner = member.role === "studio_owner";
          const suspended = member.status === "suspended";
          const asking = confirming?.id === member.id ? confirming.action : null;
          return (
            <article className="team-person" key={member.id}>
              <span className="team-avatar">{initials(member.displayName)}</span>
              <span className="team-person-name">
                <strong>{member.displayName}</strong>
                <small>{member.email}</small>
              </span>
              {isOwner ? (
                <span className="team-person-role">
                  <strong>Studio Owner</strong>
                  <small>Owns the studio, the plan and billing</small>
                </span>
              ) : (
                <label className="team-person-role">
                  <small>Role</small>
                  <select
                    disabled={busy === member.id}
                    onChange={(event) =>
                      void updateMember(member.id, { role: event.target.value })
                    }
                    value={member.role}
                  >
                    {ASSIGNABLE_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {workspaceRoleLabel(role)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <span className="team-person-actions">
                <StatusBadge tone={suspended ? "warning" : "success"}>
                  {suspended ? "Suspended" : "Active"}
                </StatusBadge>
                {isOwner ? null : suspended ? (
                  <button
                    className="button button-light"
                    disabled={busy === member.id}
                    onClick={() => void updateMember(member.id, { status: "active" })}
                    type="button"
                  >
                    Reactivate
                  </button>
                ) : (
                  <button
                    className="button button-light"
                    disabled={busy === member.id}
                    onClick={() => setConfirming({ id: member.id, action: "suspend" })}
                    type="button"
                  >
                    Suspend
                  </button>
                )}
                {isOwner ? null : (
                  <button
                    className="button button-quiet team-remove"
                    disabled={busy === member.id}
                    onClick={() => setConfirming({ id: member.id, action: "remove" })}
                    type="button"
                  >
                    Remove
                  </button>
                )}
              </span>
              {!isOwner ? (
                <p className="team-person-summary">
                  {ROLE_SUMMARY[member.role as AssignableRole] ?? ""}
                </p>
              ) : null}
              {asking ? (
                <div className="team-confirm" role="alert">
                  <span>
                    {asking === "suspend"
                      ? `Suspend ${member.displayName}? They can't sign in until you reactivate them. Nothing they did is lost.`
                      : `Remove ${member.displayName} from your studio? They lose access straight away. To bring them back, invite them again.`}
                  </span>
                  <span>
                    <button
                      className="button button-dark"
                      onClick={() =>
                        void updateMember(member.id, {
                          status: asking === "suspend" ? "suspended" : "revoked",
                        })
                      }
                      type="button"
                    >
                      {asking === "suspend" ? "Suspend" : "Remove"}
                    </button>
                    <button
                      className="button button-light"
                      onClick={() => setConfirming(null)}
                      type="button"
                    >
                      Keep access
                    </button>
                  </span>
                </div>
              ) : null}
            </article>
          );
        })}
      </section>
      {notice ? (
        <p className="form-notice" role="status">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
