"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { LoaderCircle, RotateCw } from "lucide-react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { Button, Card, Main, PoweredBy } from "@/components/kit/kit";
import { useWorkspace } from "@/features/auth/workspace-context";
import { getFirebaseClient } from "@/lib/firebase/client";
import { sendCrewCommand } from "@/lib/crew/command-client";
import { crewPublicError } from "@/lib/crew/public-error";
import { dataIsLive } from "@/lib/runtime-mode";
import { withTimeout } from "@/lib/async/with-timeout";
import { mockCrewData } from "@/features/crew/mock-crew";

/**
 * The crew workspace's data, shared by every crew screen (M6 of
 * docs/mobile-first-client-crew-plan-2026-09-28.md). Moved here unchanged in
 * what it reads from components/crew/live-crew-views.tsx, which the kit
 * screens replace; mock mode now has a crew member, so every screen can be
 * walked.
 */

export type Value = Record<string, unknown> & { id: string };
export type CrewData = {
  assignments: Value[];
  projects: Record<string, Value>;
  profile: Value | null;
  availability: Value[];
  /**
   * The studio's own record, for the one field crew need from it: the number to
   * ring on the day. Readable because `firestore.rules` allows any active
   * member to read their tenant.
   */
  studio: Value | null;
  loading: boolean;
  error: string | null;
  /**
   * What actually failed, beside the sentence a person reads. `crewPublicError`
   * maps four infrastructure conditions and otherwise returns the fallback, so
   * without this a dead end on a real phone left no thread to pull.
   */
  errorDetail: string | null;
  refresh: () => void;
};
type CrewDataState = Omit<CrewData, "refresh">;

export const text = (value: unknown, fallback = "") =>
  typeof value === "string" && value ? value : fallback;
export const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
export const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export const number = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;
export const money = (cents: unknown, currency: unknown) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: text(currency, "USD") }).format(number(cents) / 100);

/** "Sat, Jun 12" in the event's zone when it is known. */
export function dayLabel(value: unknown, timeZone?: string): string {
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.valueOf())) return "Date to be confirmed";
  return parsed.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(timeZone ? { timeZone } : {}),
  });
}

/** "1:00 PM" in the event's zone when it is known. */
export function timeLabel(value: unknown, timeZone?: string): string {
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.valueOf())) return "";
  try {
    return parsed.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      ...(timeZone ? { timeZone } : {}),
    });
  } catch {
    return parsed.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
}

export function useCrewData(): CrewData {
  const workspace = useWorkspace();
  const [refreshVersion, setRefreshVersion] = useState(0);
  const refresh = useCallback(() => setRefreshVersion((value) => value + 1), []);
  const [state, setState] = useState<CrewDataState>(() =>
    dataIsLive
      ? {
          assignments: [],
          projects: {},
          profile: null,
          availability: [],
          studio: null,
          loading: true,
          error: null,
          errorDetail: null,
        }
      : { ...mockCrewData(new Date()), loading: false, error: null, errorDetail: null },
  );
  useEffect(() => {
    if (!dataIsLive || workspace.loading) return;
    if (!workspace.tenantId || !workspace.userId) {
      queueMicrotask(() =>
        setState((current) => ({ ...current, loading: false, error: "No active crew membership was found." })),
      );
      return;
    }
    let active = true;
    // A retry that fails must still look like a retry, but a refresh after a
    // save keeps the screen: flipping to "Opening your work…" unmounted it and
    // lost its "Saved." (found by the local UAT run, 2026-09-29).
    queueMicrotask(() =>
      setState((current) =>
        current.loading || (!current.error && (current.profile || current.assignments.length))
          ? current
          : { ...current, loading: true },
      ),
    );
    const { firestore } = getFirebaseClient();
    void withTimeout(
      Promise.all([
        /**
         * Everything addressed to this person, offered or accepted. Fanning out
         * over the membership's projects hid outstanding offers, because the
         * project opens on acceptance.
         */
        getDocs(
          query(
            collection(firestore, "crewAssignments"),
            where("tenantId", "==", workspace.tenantId),
            where("userId", "==", workspace.userId),
            orderBy("arrivalAt", "desc"),
            limit(100),
          ),
        ),
        getDocs(
          query(
            collection(firestore, "crewProfiles"),
            where("tenantId", "==", workspace.tenantId),
            where("userId", "==", workspace.userId),
            limit(1),
          ),
        ),
        getDocs(
          query(
            collection(firestore, "crewAvailability"),
            where("tenantId", "==", workspace.tenantId),
            where("userId", "==", workspace.userId),
            limit(100),
          ),
        ),
      ]),
      15_000,
      "Crew workspace data took too long to load. Try again.",
    )
      .then(async ([assignmentSnapshot, profileSnapshot, availabilitySnapshot]) => {
        // With no connection Firestore answers from its cache, often empty,
        // instead of failing. Say so, so screens fall back to what is saved
        // on the phone (the day sheet) rather than showing "no jobs".
        if (assignmentSnapshot.metadata.fromCache) throw new Error("No connection right now. Showing what's saved on this phone.");
        const assignments = assignmentSnapshot.docs.map(
          (document) => ({ id: document.id, ...document.data() }) as Value,
        );
        const projectIds = Array.from(
          new Set(
            assignments
              .map((assignment) => assignment.projectId)
              .filter((projectId): projectId is string => typeof projectId === "string"),
          ),
        );
        const [projectDocuments, studioDocument] = await withTimeout(
          Promise.all([
            Promise.all(
              // An offered job is still closed to them; one refusal must not
              // take the workspace down, and the offer falls back to the name
              // it carries.
              projectIds.map((projectId) => getDoc(doc(firestore, "projects", projectId)).catch(() => null)),
            ),
            getDoc(doc(firestore, "tenants", String(workspace.tenantId))),
          ]),
          10_000,
          "Crew project details took too long to load. Try again.",
        );
        if (!active) return;
        setState({
          assignments,
          projects: Object.fromEntries(
            projectDocuments
              .filter((project) => project !== null && project.exists())
              .map((project) => [project!.id, { id: project!.id, ...project!.data() } as Value]),
          ),
          profile: profileSnapshot.docs[0]
            ? ({ id: profileSnapshot.docs[0].id, ...profileSnapshot.docs[0].data() } as Value)
            : null,
          availability: availabilitySnapshot.docs.map(
            (document) => ({ id: document.id, ...document.data() }) as Value,
          ),
          studio: studioDocument.exists() ? ({ id: studioDocument.id, ...studioDocument.data() } as Value) : null,
          loading: false,
          error: null,
          errorDetail: null,
        });
      })
      .catch((caught: unknown) => {
        if (active)
          setState((current) => ({
            ...current,
            loading: false,
            error: crewPublicError(
              caught,
              "Your crew workspace could not be loaded. Try again, or ask the studio to confirm your assignment.",
              "CREW_WORKSPACE_LOAD_FAILED",
            ),
            // Long enough for a whole Firestore index link.
            errorDetail: caught instanceof Error && caught.message.trim() ? caught.message.trim().slice(0, 600) : null,
          }));
      });
    return () => {
      active = false;
    };
  }, [workspace.loading, workspace.tenantId, workspace.userId, refreshVersion]);
  return { ...state, refresh };
}

/**
 * A crew command, or in mock mode a local "yes", so every screen can be
 * walked. Callers treat both as done.
 */
export async function crewCommand(type: string, input: Record<string, unknown>): Promise<void> {
  if (!dataIsLive) return;
  const response = await sendCrewCommand(type, input);
  if (!response.persisted) throw new Error("The crew service isn't connected in this environment.");
}

/**
 * What to call a job. The project is readable once they have accepted;
 * before that the only name they have is the one carried on the offer.
 */
export function jobName(data: CrewData, assignment: Value): string {
  const project = projectFor(data, assignment);
  return text(project?.name) || text(assignment.projectName) || "A job from your studio";
}

export function projectFor(data: CrewData, assignment: Value): Value | undefined {
  return data.projects[text(assignment.projectId)];
}

export function assignmentLocation(assignment: Value): Record<string, unknown> | null {
  return (list(assignment.locations).map(record)[0] as Record<string, unknown> | undefined) ?? null;
}

/**
 * Where to turn up. An assignment carries its own locations only once a run
 * of show pins them; before that the project's venue is the answer, and
 * "Location pending" on a booked wedding was wrong.
 */
export function assignmentPlace(assignment: Value, project: Value | null | undefined): string {
  const named = text(assignmentLocation(assignment)?.name);
  if (named) return named;
  return text(project?.venueName) || text(project?.city) || "Venue to be confirmed";
}

export function endsAt(assignment: Value): string {
  return text(assignment.departureAt) || text(assignment.arrivalAt);
}

/** The assignment named by `?assignment=`, if it's one of theirs. */
export function useAssignmentParam(data: CrewData): Value | null {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    queueMicrotask(() => setId(new URLSearchParams(window.location.search).get("assignment")));
  }, []);
  return useMemo(() => (id ? (data.assignments.find((item) => item.id === id) ?? null) : null), [data.assignments, id]);
}

/** Loading, or the reason it failed with a way to retry. Null when neither. */
export function CrewLoadState({ data, title }: { data: CrewData; title: string }) {
  const workspace = useWorkspace();
  if (!data.loading && !data.error) return null;
  return (
    <Main label={title}>
      <h1 className="kit-title">{title}</h1>
      <Card>
        {data.loading ? (
          <p className="kit-body" role="status">
            <LoaderCircle aria-hidden className="spin" size={16} /> Opening your work…
          </p>
        ) : (
          <>
            <p className="kit-body" role="alert">
              {data.error}
            </p>
            {data.errorDetail ? (
              <p className="kit-caption">{`Tell the studio this: ${data.errorDetail}`}</p>
            ) : null}
            <Button
              icon={RotateCw}
              onClick={() => {
                // Both: the workspace re-resolves the membership, and this
                // re-runs the crew reads even when it is unchanged.
                workspace.retry();
                data.refresh();
              }}
              variant="secondary"
            >
              Try again
            </Button>
          </>
        )}
      </Card>
      <PoweredBy />
    </Main>
  );
}
