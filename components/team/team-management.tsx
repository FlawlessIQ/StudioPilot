"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  collection,
  getDocs,
  limit,
  query,
  where,
} from "firebase/firestore";
import {
  Check,
  Clipboard,
  LoaderCircle,
  ShieldCheck,
  UserMinus,
  UserPlus,
  UsersRound,
  X,
} from "lucide-react";
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
          .filter((member) => member.status !== "revoked"),
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
        "Invitation created. Outbound email remains gated until the sending domain is approved; you can securely copy the link now.",
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
      setNotice("Invitation revoked.");
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
      setNotice("Member access updated and audited.");
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
          <strong>Studio Owner access required</strong>
          <small>
            Team roles, invitations, and user limits affect tenant security.
          </small>
        </span>
      </section>
    );
  }

  return (
    <div className="team-management">
      <section className="panel team-invite-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Workspace access</p>
            <h2>Invite a team member</h2>
          </div>
          <UserPlus />
        </div>
        <form className="team-invite-form" onSubmit={(event) => void invite(event)}>
          <label>
            Name
            <input name="displayName" required minLength={2} />
          </label>
          <label>
            Email
            <input name="email" required type="email" />
          </label>
          <label>
            Role
            <select name="role" defaultValue="studio_coordinator">
              <option value="studio_admin">Studio Admin</option>
              <option value="studio_coordinator">Studio Coordinator</option>
              <option value="staff_photographer">Staff Photographer</option>
            </select>
          </label>
          <button
            className="button button-dark"
            disabled={busy === "invite"}
            type="submit"
          >
            {busy === "invite" ? <LoaderCircle className="spin" /> : <UserPlus />}
            Create invitation
          </button>
        </form>
        {inviteUrl ? (
          <div className="team-invite-link">
            <Check />
            <span>
              <strong>One-time invitation link</strong>
              <small>{inviteUrl}</small>
            </span>
            <button
              type="button"
              onClick={() => void navigator.clipboard.writeText(inviteUrl)}
            >
              <Clipboard size={15} /> Copy
            </button>
          </div>
        ) : null}
      </section>

      {invitations.length ? (
        <section className="panel team-list">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Pending</p>
              <h2>Open invitations</h2>
            </div>
          </div>
          {invitations.map((invitation) => (
            <article key={invitation.id}>
              <UserPlus />
              <span>
                <strong>{invitation.displayName}</strong>
                <small>{invitation.email}</small>
              </span>
              <span>
                <strong>{workspaceRoleLabel(invitation.role)}</strong>
                <small>
                  Expires {formatDueDate(invitation.expiresAt)}
                </small>
              </span>
              <StatusBadge tone="warning">Pending</StatusBadge>
              <button
                aria-label={`Revoke invitation for ${invitation.displayName}`}
                disabled={busy === invitation.id}
                onClick={() => void revokeInvitation(invitation.id)}
                type="button"
              >
                <X size={16} />
              </button>
            </article>
          ))}
        </section>
      ) : null}

      <section className="panel team-list">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Active access</p>
            <h2>Team members</h2>
          </div>
          <UsersRound />
        </div>
        {members.map((member) => (
          <article key={member.id}>
            <UsersRound />
            <span>
              <strong>{member.displayName}</strong>
              <small>{member.email}</small>
            </span>
            {member.role === "studio_owner" ? (
              <span>
                <strong>Studio Owner</strong>
                <small>Tenant owner</small>
              </span>
            ) : (
              <select
                aria-label={`Role for ${member.displayName}`}
                value={member.role}
                disabled={busy === member.id}
                onChange={(event) =>
                  void updateMember(member.id, { role: event.target.value })
                }
              >
                <option value="studio_admin">Studio Admin</option>
                <option value="studio_coordinator">Studio Coordinator</option>
                <option value="staff_photographer">Staff Photographer</option>
              </select>
            )}
            <StatusBadge tone={member.status === "active" ? "success" : "warning"}>
              {member.status}
            </StatusBadge>
            {member.role !== "studio_owner" ? (
              <button
                aria-label={`${member.status === "active" ? "Suspend" : "Reactivate"} ${member.displayName}`}
                disabled={busy === member.id}
                onClick={() =>
                  void updateMember(member.id, {
                    status: member.status === "active" ? "suspended" : "active",
                  })
                }
                type="button"
              >
                {member.status === "active" ? (
                  <UserMinus size={16} />
                ) : (
                  <Check size={16} />
                )}
              </button>
            ) : (
              <span />
            )}
          </article>
        ))}
      </section>
      {notice ? (
        <p className="form-notice" role="status">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
