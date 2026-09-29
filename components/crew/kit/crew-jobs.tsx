"use client";

import { useState } from "react";
import { BriefcaseBusiness, CheckCircle2, Send, XCircle } from "lucide-react";
import { Card, List, Main, Pill, PoweredBy, Row } from "@/components/kit/kit";
import { offerCanBeAnswered } from "@/features/crew/offer-moment";
import { splitUpcomingAndPast } from "@/features/ordering/attention";
import { statusLabel } from "@/features/format/status-label";
import {
  CrewLoadState,
  dayLabel,
  jobName,
  money,
  text,
  useCrewData,
  type CrewData,
  type Value,
} from "@/components/crew/kit/crew-data";

/**
 * Jobs (M6 of docs/mobile-first-client-crew-plan-2026-09-28.md): compact rows
 * in three groups, each opening its own screen. It was every job as an
 * expanded card, a very long page; queues on a phone are rows
 * (the rule recorded as "mobile queues must be compact").
 */
export function CrewJobs() {
  const data = useCrewData();
  const [now] = useState(() => new Date());
  if (data.loading || data.error) return <CrewLoadState data={data} title="Jobs" />;

  const pending = (item: Value) => ["invited", "viewed"].includes(String(item.status));
  const offers = data.assignments.filter(pending);
  const rest = data.assignments.filter((item) => !pending(item));
  // Next job first, finished work after: a wedding 27 days gone once sat
  // among live work with "Open schedule & prep" beside it.
  const split = splitUpcomingAndPast(rest, (item) => item.arrivalAt, now);
  const upcoming = split.upcoming.filter((item) => item.status === "accepted");
  const finished = [...split.past, ...split.upcoming.filter((item) => item.status !== "accepted")];

  return (
    <Main label="Jobs">
      <div className="kit-stack-tight">
        <p className="kit-eyebrow">Your work</p>
        <h1 className="kit-title">Jobs</h1>
      </div>
      {!data.assignments.length ? (
        <Card>
          <p className="kit-body" role="status">
            New offers from your studio will appear here, with what you need to decide.
          </p>
        </Card>
      ) : null}
      <JobGroup data={data} items={offers} label="Offers" now={now} />
      <JobGroup data={data} items={upcoming} label="Coming up" now={now} />
      <JobGroup data={data} items={finished} label="Finished" now={now} />
      <PoweredBy />
    </Main>
  );
}

function JobGroup({ data, items, label, now }: { data: CrewData; items: Value[]; label: string; now: Date }) {
  if (!items.length) return null;
  return (
    <section aria-label={label} className="kit-stack-tight">
      <h2 className="kit-subsection">{label}</h2>
      <List>
        {items.map((item) => {
          const status = String(item.status);
          const offer = ["invited", "viewed"].includes(status);
          const open =
            offer &&
            offerCanBeAnswered({
              status,
              inviteExpiresAt: text(item.inviteExpiresAt),
              arrivalAt: text(item.arrivalAt),
              now,
            });
          const fee = item.compensationVisibleToCrew ? money(item.compensationCents, item.currency) : null;
          return (
            <Row
              href={`/crew/${offer ? "pending" : "prep"}?assignment=${encodeURIComponent(item.id)}`}
              icon={offer ? Send : status === "declined" ? XCircle : status === "completed" ? CheckCircle2 : BriefcaseBusiness}
              key={item.id}
              subtitle={[dayLabel(item.arrivalAt), text(item.role), fee].filter(Boolean).join(" · ")}
              title={jobName(data, item)}
              trailing={
                offer ? (
                  open ? (
                    <Pill tone="accent">Answer</Pill>
                  ) : (
                    <Pill>Closed</Pill>
                  )
                ) : status === "declined" ? (
                  <Pill>Declined</Pill>
                ) : status !== "accepted" ? (
                  <Pill>{statusLabel(status)}</Pill>
                ) : undefined
              }
            />
          );
        })}
      </List>
    </section>
  );
}
