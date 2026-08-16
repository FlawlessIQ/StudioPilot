"use client";

import { useEffect, useState } from "react";
import { CalendarPlus, CheckCircle2, XCircle } from "lucide-react";
import { sendCrewCommand } from "@/lib/crew/command-client";
import { crewPublicError } from "@/lib/crew/public-error";

type Props = {
  assignmentId: string;
  projectId: string;
  initialStatus: "invited" | "viewed" | "accepted";
  currentScheduleId?: string;
  currentScheduleVersion?: number;
  startsAt?: string;
  endsAt?: string;
  projectName?: string;
  role?: string;
  location?: string;
  initialCalendarStatus?: string;
  initialAcknowledgedScheduleVersion?: number | null;
  onAssignmentChanged?: (change: {
    status?: "accepted" | "declined";
    calendarDownloaded?: boolean;
    acknowledgedScheduleVersion?: number;
  }) => void;
};

export function AssignmentActions({
  assignmentId,
  projectId,
  initialStatus,
  currentScheduleId,
  currentScheduleVersion = 0,
  startsAt,
  endsAt,
  projectName = "Photography assignment",
  role = "Crew",
  location = "See StudioCue brief",
  initialCalendarStatus = "not_added",
  initialAcknowledgedScheduleVersion = null,
  onAssignmentChanged,
}: Props) {
  const [status, setStatus] = useState<string>(
    initialStatus === "viewed" ? "invited" : initialStatus,
  );
  const [calendarDownloaded, setCalendarDownloaded] = useState(
    initialCalendarStatus === "added" || initialCalendarStatus === "downloaded",
  );
  const [scheduleAcknowledged, setScheduleAcknowledged] = useState(
    currentScheduleVersion > 0 &&
      initialAcknowledgedScheduleVersion === currentScheduleVersion,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [interactive, setInteractive] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setInteractive(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  const run = async (
    action: string,
    type: string,
    input: Record<string, unknown>,
    success: string,
  ) => {
    setNotice(null);
    if (busyAction) return false;
    setBusyAction(action);
    try {
      const response = await sendCrewCommand(type, { projectId, assignmentId, ...input });
      setNotice(response.persisted ? success : `Development preview: ${success.toLowerCase()} No server record was changed.`);
      return response.persisted;
    } catch (caught: unknown) {
      setNotice(crewPublicError(caught, "The assignment could not be updated.", "CREW_ASSIGNMENT_UPDATE_FAILED"));
      return false;
    } finally {
      setBusyAction(null);
    }
  };
  const respond = async (decision: "accepted" | "declined") => {
    const persisted = await run(
      `respond-${decision}`,
      "respondAssignment",
      { decision },
      decision === "accepted" ? "Assignment accepted." : "Assignment declined.",
    );
    if (!persisted) return;
    setStatus(decision);
    onAssignmentChanged?.({ status: decision });
  };
  const addCalendar = async () => {
    if (!startsAt || !endsAt)
      throw new Error("Assignment dates are not available.");
    const calendarDate = (value: string) =>
      new Date(value)
        .toISOString()
        .replaceAll("-", "")
        .replaceAll(":", "")
        .replace(/\.\d{3}Z$/, "Z");
    const escaped = (value: string) =>
      value.replaceAll("\\", "\\\\").replaceAll(",", "\\,").replaceAll("\n", "\\n");
    const ics = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//StudioCue//Crew Assignment//EN",
      "BEGIN:VEVENT", `UID:${assignmentId}@studiocue`, `DTSTART:${calendarDate(startsAt)}`,
      `DTEND:${calendarDate(endsAt)}`, `SUMMARY:${escaped(projectName)} — ${escaped(role)}`,
      `LOCATION:${escaped(location)}`, "DESCRIPTION:StudioCue crew assignment",
      "END:VEVENT", "END:VCALENDAR",
    ].join("\r\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    link.download = `studiocue-${assignmentId}.ics`;
    link.click();
    URL.revokeObjectURL(link.href);
    setCalendarDownloaded(true);
    const persisted = await run(
      "calendar",
      "acknowledgeCalendar",
      {},
      "Calendar file downloaded and recorded.",
    );
    if (persisted) onAssignmentChanged?.({ calendarDownloaded: true });
  };
  const acknowledge = async () => {
    if (!currentScheduleId || currentScheduleVersion < 1)
      throw new Error("No published schedule is available.");
    const persisted = await run(
      "schedule",
      "acknowledgeSchedule",
      { scheduleId: currentScheduleId, scheduleVersion: currentScheduleVersion },
      `Schedule version ${currentScheduleVersion} acknowledged.`,
    );
    if (!persisted) return;
    setScheduleAcknowledged(true);
    onAssignmentChanged?.({ acknowledgedScheduleVersion: currentScheduleVersion });
  };
  if (status === "declined") return <div className="crew-action-result" role="status"><XCircle size={18}/><span><strong>Assignment declined</strong><small>The studio has been notified to reassign this role.</small></span></div>;
  return <div className="crew-action-stack">
    {status === "invited" ? <div className="crew-action-row"><button className="button button-dark" type="button" disabled={!interactive||busyAction!==null} aria-busy={busyAction==="respond-accepted"} onClick={()=>void respond("accepted")}><CheckCircle2 size={16}/> {busyAction==="respond-accepted"?"Accepting…":"Accept job"}</button><button className="button button-light" type="button" disabled={!interactive||busyAction!==null} aria-busy={busyAction==="respond-declined"} onClick={()=>void respond("declined")}><XCircle size={16}/> {busyAction==="respond-declined"?"Declining…":"Decline"}</button></div> : <>
      <div className="crew-action-row"><button className="button button-light" type="button" onClick={()=>void addCalendar().catch(caught=>setNotice(crewPublicError(caught,"The calendar file could not be prepared.","CREW_CALENDAR_DOWNLOAD_FAILED")))} disabled={!interactive||busyAction!==null||!startsAt||!endsAt} aria-busy={busyAction==="calendar"}><CalendarPlus size={16}/>{busyAction==="calendar"?"Recording download…":calendarDownloaded?"Download calendar file again":"Download calendar event"}</button>{currentScheduleId&&currentScheduleVersion>0?<button className="button button-dark" type="button" onClick={()=>void acknowledge().catch(caught=>setNotice(crewPublicError(caught,"The schedule could not be acknowledged.","CREW_SCHEDULE_ACKNOWLEDGE_FAILED")))} disabled={!interactive||busyAction!==null||scheduleAcknowledged} aria-busy={busyAction==="schedule"}><CheckCircle2 size={16}/>{busyAction==="schedule"?"Acknowledging…":scheduleAcknowledged?`Version ${currentScheduleVersion} acknowledged`:"Acknowledge current schedule"}</button>:null}</div>
    </>}
    {notice?<p className="form-notice" role="status">{notice}</p>:null}
  </div>;
}
