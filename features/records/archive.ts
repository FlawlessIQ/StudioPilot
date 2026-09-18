/**
 * Taking a record out of the working list.
 *
 * Every collection in `firestore.rules` refuses a delete, and that is right:
 * a client is named on projects, proposals and messages; a vendor on insurance
 * requirements; a collaborator on assignments and closeouts. Deleting any of
 * them would leave records that no longer make sense. So the product archives.
 *
 * The gap this closes is that nothing could archive anything. The People page
 * has always had an "Archived" filter and no way to put a record in it, and
 * "delete" was the word the studio reached for because "archive" was not
 * offered anywhere.
 *
 * Jobs were then left out of exactly that fix. The Jobs list has had an
 * Archived tab since it was built, the job page offers only "put on hold" and
 * "cancel", and the studio it is validated against asked "how do I
 * delete/archive a job?" — reaching for "delete" for the same reason, one
 * entity over.
 *
 * These are the words and the refusals, in one place, because three entities
 * now share them and a studio should meet the same idea each time.
 */

export type ArchivableKind = "client" | "vendor" | "crew" | "job";

const COPY: Record<
  ArchivableKind,
  { archive: string; restore: string; confirm: string; kept: string }
> = {
  client: {
    archive: "Archive client",
    restore: "Restore client",
    confirm: "Archive this client? They move to the Archived filter.",
    kept: "Their projects, proposals and messages are kept.",
  },
  vendor: {
    archive: "Archive vendor",
    restore: "Restore vendor",
    confirm: "Archive this vendor? They stop appearing when you pick a venue.",
    kept: "Insurance requests and project records naming them are kept.",
  },
  job: {
    archive: "Archive job",
    restore: "Restore job",
    // Says what it is *not*, because a studio archiving a wedding that is
    // actually off wants Cancel — which keeps the reason and tells the rest of
    // the product to stop chasing it.
    confirm:
      "Archive this job? It moves to the Archived tab and stops appearing as live work. If the wedding is off, cancel it instead.",
    kept: "Its proposal, agreement, payments and messages are kept.",
  },
  crew: {
    archive: "Remove from directory",
    restore: "Return to directory",
    confirm:
      "Remove this collaborator from your directory? They stop being offered work.",
    kept: "Past assignments, schedules and closeouts are kept.",
  },
};

export function archiveCopy(kind: ArchivableKind, archived: boolean) {
  const copy = COPY[kind];
  return {
    label: archived ? copy.restore : copy.archive,
    confirm: archived ? null : copy.confirm,
    kept: copy.kept,
  };
}

/**
 * Why the server refused, in words the studio can act on.
 *
 * Both refusals are deliberate rather than defensive: archiving the client of a
 * wedding in flight, or a collaborator who still holds an assignment, would
 * hide someone the studio is currently relying on.
 */
export const ARCHIVE_REFUSALS: Record<string, string> = {
  CONTACT_HAS_LIVE_PROJECT:
    "This client has a job that is still live. Close, cancel or finish it first.",
  CREW_HAS_OPEN_ASSIGNMENT:
    "This collaborator still holds an assignment. Settle or withdraw it first.",
  CREW_IDENTITY_OWNED_BY_MEMBER:
    "They have their own account now, so their name and email are theirs to change. You can still update rate, specialties and areas.",
  CONTACT_NOT_FOUND: "That client record could not be found.",
  VENDOR_NOT_FOUND: "That vendor record could not be found.",
  CREW_PROFILE_NOT_FOUND: "That collaborator could not be found.",
  PROJECT_NOT_FOUND: "That job could not be found.",
};
