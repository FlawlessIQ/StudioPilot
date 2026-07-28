"use client";
import { useEffect, useState, type FormEvent } from "react";
import { Save, Send } from "lucide-react";
import { collection, getDocs, limit, query, where } from "firebase/firestore";
import { sendPlanningCommand } from "@/lib/planning/command-client";
import { getFirebaseClient } from "@/lib/firebase/client";
import { dataIsLive } from "@/lib/runtime-mode";
export function ClientQuestionnaireForm({
  projectId: assignedProjectId,
  responseId: assignedResponseId,
  initialAnswers = {},
}: {
  projectId?: string;
  responseId?: string;
  initialAnswers?: Record<string, unknown>;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [context, setContext] = useState(
    assignedProjectId && assignedResponseId
      ? { projectId: assignedProjectId, responseId: assignedResponseId }
      : dataIsLive
        ? null
        : {
            projectId: "wedding-booked",
            responseId: "wedding-booked-planning",
          },
  );
  useEffect(() => {
    if (!dataIsLive || (assignedProjectId && assignedResponseId)) return;
    let active = true;
    void (async () => {
      const { auth, firestore } = getFirebaseClient();
      const user = auth.currentUser;
      if (!user) return;
      const memberships = await getDocs(
        query(
          collection(firestore, "memberships"),
          where("userId", "==", user.uid),
          where("status", "==", "active"),
          limit(1),
        ),
      );
      const membership = memberships.docs[0]?.data();
      const tenantId = membership?.tenantId;
      const projectId = Array.isArray(membership?.projectIds)
        ? membership.projectIds[0]
        : null;
      if (typeof tenantId !== "string" || typeof projectId !== "string") return;
      const responses = await getDocs(
        query(
          collection(firestore, "questionnaireResponses"),
          where("tenantId", "==", tenantId),
          where("projectId", "==", projectId),
          limit(1),
        ),
      );
      const responseId = responses.docs[0]?.id;
      if (active && responseId) setContext({ projectId, responseId });
    })().catch(() => setNotice("Questionnaire context could not be loaded."));
    return () => {
      active = false;
    };
  }, [assignedProjectId, assignedResponseId]);
  async function save(form: HTMLFormElement, submitResponse: boolean) {
    setBusy(true);
    setNotice(null);
    const data = new FormData(form);
    const answers = {
      planner: String(data.get("planner")),
      ceremonyTime: String(data.get("ceremonyTime")),
      familyPhotoList: String(data.get("familyPhotoList")),
      accessibilityNeeds: String(data.get("accessibilityNeeds")),
    };
    try {
      if (!context) throw new Error("No questionnaire is assigned.");
      const response = await sendPlanningCommand("saveQuestionnaire", {
        responseId: context.responseId,
        projectId: context.projectId,
        answers,
        submit: submitResponse,
      });
      setNotice(
        response.persisted
          ? submitResponse
            ? "Questionnaire submitted for studio review."
            : "Draft saved securely."
          : `Development preview: ${submitResponse ? "submission" : "draft"} validated, but no answers were persisted.`,
      );
    } catch (caught: unknown) {
      setNotice(
        caught instanceof Error
          ? caught.message
          : "Questionnaire could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save(event.currentTarget, false);
  }
  return (
    <form className="planning-form-preview" onSubmit={submit}>
      <label>
        <span>Planner</span>
        <input name="planner" defaultValue={String(initialAnswers.planner ?? "")} />
      </label>
      <label>
        <span>Ceremony time</span>
        <input name="ceremonyTime" type="time" defaultValue={String(initialAnswers.ceremonyTime ?? "")} />
      </label>
      <label>
        <span>Family photo list</span>
        <textarea name="familyPhotoList" defaultValue={String(initialAnswers.familyPhotoList ?? "")} placeholder="One group per line" />
      </label>
      <label>
        <span>Accessibility needs</span>
        <textarea
          name="accessibilityNeeds"
          defaultValue={String(initialAnswers.accessibilityNeeds ?? "")}
          placeholder="Share anything the team should plan for"
        />
      </label>
      <div className="questionnaire-actions">
        <button className="button button-light" disabled={busy} type="submit">
          <Save size={16} /> Save draft
        </button>
        <button
          className="button button-dark"
          disabled={busy}
          type="button"
          onClick={(event) => {
            const form = event.currentTarget.form;
            if (form) void save(form, true);
          }}
        >
          <Send size={16} /> Submit questionnaire
        </button>
      </div>
      {notice ? (
        <p className="form-notice" role="status">
          {notice}
        </p>
      ) : null}
    </form>
  );
}
