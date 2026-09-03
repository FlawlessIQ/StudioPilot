import { redirect } from "next/navigation";

/**
 * /crew/event-day and /crew/schedule rendered byte-identical output — the
 * `context` prop changed only the heading. One brief now, at /crew/schedule,
 * which is where the offline page and the crew-offer email already send
 * people. Alias kept so nothing that linked here dead-ends.
 */
export default function CrewEventDayAlias() {
  redirect("/crew/schedule");
}
