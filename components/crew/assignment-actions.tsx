"use client";

import { useEffect, useState } from "react";
import { CalendarPlus, CheckCircle2, XCircle } from "lucide-react";
import { sendCrewCommand } from "@/lib/crew/command-client";

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
}: Props) {
  const [status, setStatus] = useState<string>(
    initialStatus === "viewed" ? "invited" : initialStatus,
  );
  const [calendarAdded, setCalendarAdded] = useState(false);
  const [scheduleAcknowledged, setScheduleAcknowledged] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [interactive, setInteractive] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setInteractive(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  const run = async (type: string, input: Record<string, unknown>, success: string) => {
    setNotice(null);
    try {
      const response = await sendCrewCommand(type, { projectId, assignmentId, ...input });
      setNotice(response.persisted ? success : `Development preview: ${success.toLowerCase()} No server record was changed.`);
    } catch (caught: unknown) {
      setNotice(caught instanceof Error ? caught.message : "The assignment could not be updated.");
    }
  };
  const respond = async (decision: "accepted" | "declined") => {
    await run("respondAssignment", { decision }, decision === "accepted" ? "Assignment accepted." : "Assignment declined.");
    setStatus(decision);
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
    await run("acknowledgeCalendar", {}, "Calendar file downloaded and acknowledgement recorded.");
    setCalendarAdded(true);
  };
  const acknowledge = async () => {
    if (!currentScheduleId || currentScheduleVersion < 1)
      throw new Error("No published schedule is available.");
    await run("acknowledgeSchedule", { scheduleId: currentScheduleId, scheduleVersion: currentScheduleVersion }, `Schedule version ${currentScheduleVersion} acknowledged.`);
    setScheduleAcknowledged(true);
  };
  if (status === "declined") return <div className="crew-action-result" role="status"><XCircle size={18}/><span><strong>Assignment declined</strong><small>The studio has been notified to reassign this role.</small></span></div>;
  return <div className="crew-action-stack">
    {status === "invited" ? <div className="crew-action-row"><button className="button button-dark" type="button" disabled={!interactive} onClick={()=>respond("accepted")}><CheckCircle2 size={16}/> Accept job</button><button className="button button-light" type="button" disabled={!interactive} onClick={()=>respond("declined")}><XCircle size={16}/> Decline</button></div> : <>
      <div className="crew-action-row"><button className="button button-light" type="button" onClick={()=>void addCalendar().catch(caught=>setNotice(caught instanceof Error?caught.message:"Calendar download failed."))} disabled={!interactive||calendarAdded||!startsAt||!endsAt}><CalendarPlus size={16}/>{calendarAdded?"Added to calendar":"Add to calendar"}</button>{currentScheduleId&&currentScheduleVersion>0?<button className="button button-dark" type="button" onClick={()=>void acknowledge().catch(caught=>setNotice(caught instanceof Error?caught.message:"Schedule acknowledgement failed."))} disabled={!interactive||scheduleAcknowledged}><CheckCircle2 size={16}/>{scheduleAcknowledged?`Version ${currentScheduleVersion} acknowledged`:"Acknowledge current schedule"}</button>:null}</div>
    </>}
    {notice?<p className="form-notice" role="status">{notice}</p>:null}
  </div>;
}
