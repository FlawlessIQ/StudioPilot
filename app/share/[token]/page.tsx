import { createHash } from "node:crypto";
import type { Metadata } from "next";
import { adminFirestore } from "@/server/firebase/admin";
import {
  vendorVisibleItems,
  type ScheduleShareScope,
} from "@/features/schedules/vendor-share";
import { displayPhone, vendorContactSheet } from "@/features/vendors/team";
import { spokenClock } from "@/features/schedules/day-clock";
import type { ScheduleItem } from "@/features/schedules/schema";
import { tradeVocab } from "@/features/trades/trades";
import { shareOfferFor } from "@/server/vendors/vendor-offer";
import { jobKindOf, vocab } from "@/features/job-kinds/job-kinds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Run of show" };

/**
 * The read-only run of show a wedding vendor opens from their link.
 *
 * No account, no Firestore access on their side — the token in the URL is the
 * whole credential, resolved here with admin credentials. They see only the
 * segments that concern them (studio-only rows are never shared), and a single
 * action: confirm it works. Opening the page marks it viewed so the studio
 * knows it landed; confirming is a POST (a link scanner must not confirm on the
 * vendor's behalf), the same split the reply-approval flow uses.
 */

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="ds-root ros-share" data-ds-theme="emerald">
      <article className="ros-share-card">{children}</article>
    </main>
  );
}

function Unavailable({ title, body }: { title: string; body: string }) {
  return (
    <Shell>
      <p className="ros-eyebrow">Run of show</p>
      <h1>{title}</h1>
      <p className="ros-lead">{body}</p>
    </Shell>
  );
}

export default async function RunOfShowSharePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams?: Promise<{ confirmed?: string }>;
}) {
  const { token } = await params;
  // Just confirmed (POST /api/share-ack sends them back here): say so at the top.
  const justConfirmed = (await searchParams)?.confirmed === "1";
  const now = new Date().toISOString();

  const snapshot = await adminFirestore
    .collection("scheduleShares")
    .where("tokenHash", "==", hash(token))
    .limit(1)
    .get();
  const shareDoc = snapshot.docs[0];
  const share = shareDoc?.data();

  if (!share || share.status === "revoked") {
    return (
      <Unavailable
        title="This link isn't active"
        body="The studio may have replaced it with a newer one. Ask them to resend the latest run of show."
      />
    );
  }
  if (String(share.expiresAt ?? "") < now) {
    return (
      <Unavailable
        title="This link has expired"
        body="Ask the studio to resend the run of show and you'll get a fresh link."
      />
    );
  }

  const [scheduleSnap, projectSnap, tenantSnap, teamSnap] = await Promise.all([
    adminFirestore.doc(`schedules/${String(share.scheduleId)}`).get(),
    adminFirestore.doc(`projects/${String(share.projectId)}`).get(),
    adminFirestore.doc(`tenants/${String(share.tenantId)}`).get(),
    adminFirestore
      .collection("projectVendors")
      .where("tenantId", "==", String(share.tenantId))
      .where("projectId", "==", String(share.projectId))
      .get(),
  ]);
  // Everyone working the day, and how to reach them (features/vendors/team.ts).
  const contacts = vendorContactSheet(teamSnap.docs.map((entry) => entry.data()));
  const schedule = scheduleSnap.data();
  if (!schedule) {
    return (
      <Unavailable
        title="Run of show unavailable"
        body="Ask the studio to resend it."
      />
    );
  }
  const project = projectSnap.data() ?? {};
  const tenant = tenantSnap.data() ?? {};

  const allItems = Array.isArray(schedule.items)
    ? (schedule.items as ScheduleItem[])
    : [];
  const items = vendorVisibleItems(
    allItems,
    String(share.vendorContactId),
    (share.scope as ScheduleShareScope) ?? "vendor",
  ).sort((a, b) => a.startAt.localeCompare(b.startAt));

  const timezone = String(schedule.timezone ?? "UTC");
  const timeFmt = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  });
  const dayFmt = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: timezone,
  });
  const eventDay = items[0] ? dayFmt.format(new Date(items[0].startAt)) : "";

  // Opening the page marks it viewed — the point of the feature — but never
  // downgrades an acknowledgement, and only writes once.
  if (share.status === "sent") {
    await shareDoc!.ref.update({
      status: "viewed",
      viewedAt: now,
      viewedVersion: share.sharedVersion ?? null,
      updatedAt: now,
    });
  }
  const acknowledged = share.status === "acknowledged";

  const studioName = String(
    tenant.brandName ?? tenant.businessName ?? "the studio",
  );
  // `clientName` is not always set — the couple's names live on the contacts —
  // and a planner opening this read "the couple · Saturday, May 15" as though
  // the studio could not be bothered. The job's own name is the next best
  // thing a vendor will recognise.
  const couple =
    String(project.clientName ?? "").trim() ||
    String(project.name ?? "").trim() ||
    "the couple";
  const venue = project.venueName ? String(project.venueName) : null;
  // What the studio provides, in its trade's word: a DJ's plan is a music plan.
  const service = tradeVocab(tenant.trade).service;
  // StudioCue's offer to a vendor who isn't on it yet (server/vendors/vendor-offer.ts).
  // Never in the way of the timeline: a failure here shows the page without it.
  const offer = await shareOfferFor(adminFirestore, {
    tenantId: String(share.tenantId),
    vendorId: String(share.vendorContactId ?? ""),
    studioName,
  }).catch(() => null);

  return (
    <Shell>
      <p className="ros-eyebrow">Run of show · {String(share.vendorCompany ?? "")}</p>
      <h1>
        {couple}
        {eventDay ? <span className="ros-day"> · {eventDay}</span> : null}
      </h1>
      {venue ? <p className="ros-venue">{venue}</p> : null}

      {justConfirmed && acknowledged ? (
        <p className="ros-confirmed ros-confirmed-banner" role="status">
          {`✓ You’re confirmed. ${studioName} has been notified, and if anything changes they’ll send you the update.`}
        </p>
      ) : null}

      {/* When the planner owns the day, this page is the photography plan, not
          the timeline everyone follows. Saying so here stops a vendor working
          to a copy the planner has already moved on from. */}
      {project.timelineAuthority === "planner" ? (
        <p className="ros-planner-led">
          {project.plannerName ? String(project.plannerName) : "The planner"}{" "} keeps the
          timeline for this wedding. This is {studioName}&rsquo;s {service}{" "}plan — where
          the two differ, follow the planner&rsquo;s.
        </p>
      ) : null}

      {share.message ? (
        <div className="ros-note">
          {String(share.message)
            .split("\n")
            .map((line, index) => (
              <p key={index}>{line || " "}</p>
            ))}
          <span className="ros-note-from">— {studioName}</span>
        </div>
      ) : null}

      <ol className="ros-timeline">
        {items.length === 0 ? (
          <li className="ros-empty">
            No segments are shared with you yet — check back after the studio
            updates the timeline.
          </li>
        ) : (
          items.map((segment) => (
            <li key={segment.id} className="ros-segment">
              <div className="ros-time">
                <strong>{timeFmt.format(new Date(segment.startAt))}</strong>
                <span>{timeFmt.format(new Date(segment.endAt))}</span>
              </div>
              <div className="ros-body">
                <h2>{segment.title}</h2>
                {segment.location || segment.address ? (
                  <p className="ros-where">
                    {[segment.location, segment.address]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                ) : null}
                {segment.description ? (
                  <p className="ros-desc">{segment.description}</p>
                ) : null}
                {segment.notes ? (
                  <p className="ros-seg-note">{segment.notes}</p>
                ) : null}
              </div>
            </li>
          ))
        )}
      </ol>

      {contacts.length ? (
        <section className="ros-contacts" aria-label="Who's working this day">
          <h2>Who&rsquo;s working this day</h2>
          <ul>
            {contacts.map((contact) => (
              <li key={`${contact.category}-${contact.company}`}>
                <strong>{contact.company}</strong>
                <span className="ros-contact-role">
                  {[contact.category, contact.contactName, contact.arrival ? `arrives ${spokenClock(contact.arrival)}` : ""]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <span className="ros-contact-ways">
                  {contact.phone ? <a href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`}>{displayPhone(contact.phone)}</a> : null}
                  {contact.email ? <a href={`mailto:${contact.email}`}>{contact.email}</a> : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="ros-confirm">
        {acknowledged ? (
          <p className="ros-confirmed">
            ✓ Confirmed
            {" "}{share.acknowledgedAt
              ? ` on ${dayFmt.format(new Date(String(share.acknowledgedAt)))}`
              : ""}
            . Thank you — the studio has been notified.
          </p>
        ) : (
          <form method="post" action="/api/share-ack" className="ros-confirm-form">
            <input type="hidden" name="token" value={token} />
            <p>Does this timeline work for you?</p>
            <button type="submit" className="button button-dark">
              Confirm it works
            </button>
            <span className="ros-confirm-hint">
              Need a change? Reply to {studioName}{" "} directly.
            </span>
          </form>
        )}
      </div>

      {offer ? (
        <aside className="ros-offer" aria-label="From StudioCue">
          <p className="ros-offer-from">From StudioCue</p>
          <h2>{offer.headline}</h2>
          <p>
            {offer.studioName}{" "}runs this {vocab(jobKindOf(project)).event} on StudioCue. Because you worked it: {offer.summary}.
          </p>
          <p className="ros-offer-code">
            Your code <strong>{offer.code}</strong>
          </p>
          <a className="button button-light" href={offer.url}>
            Try it at the vendor price
          </a>
        </aside>
      ) : null}
    </Shell>
  );
}
