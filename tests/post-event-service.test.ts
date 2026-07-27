import assert from "node:assert/strict";
import test from "node:test";
import { postProductionRecordSchema, projectCloseoutSchema, reviewRequestSchema } from "../features/post-production/schema";
import { aggregateStudioReport, completePostProductionStep, evaluateCloseout, recordReviewEngagement, reviewSchedule } from "../server/services/post-event-service";

const audit = { createdAt:"2026-07-01T12:00:00.000Z",updatedAt:"2026-07-01T12:00:00.000Z",createdBy:"owner",updatedBy:"owner" };
const emptyStep = { complete:false,completedAt:null,completedBy:null,evidenceId:null,notes:null };
const record = postProductionRecordSchema.parse({ ...audit,id:"post-a",tenantId:"tenant-a",projectId:"project-a",steps:{
  backup_complete:emptyStep,cull_complete:emptyStep,editing_started:emptyStep,editing_complete:emptyStep,
  gallery_ready:emptyStep,album_proof_ready:emptyStep,delivery_sent:emptyStep,client_downloaded:emptyStep,project_archived:emptyStep,
},currentStep:"backup_complete",targetDeliveryDate:"2026-08-01",archivedAt:null });

test("post-production steps enforce deterministic dependencies", () => {
  assert.throws(()=>completePostProductionStep(record,"editing_started","owner",audit.updatedAt,null));
  const backedUp=completePostProductionStep(record,"backup_complete","owner",audit.updatedAt,"backup-log");
  assert.equal(backedUp.steps.backup_complete?.evidenceId,"backup-log");
});

test("review timing starts three days after delivery and reminders seven days later", () => {
  assert.deepEqual(reviewSchedule("2026-07-01"),{
    firstAt:"2026-07-04T12:00:00.000Z",reminderAt:"2026-07-11T12:00:00.000Z",
  });
});

test("a review click never claims a review was posted", () => {
  const request=reviewRequestSchema.parse({ ...audit,id:"review-a",tenantId:"tenant-a",projectId:"project-a",deliveryRecordId:"delivery-a",channel:"email",destinationLabel:"google",destinationUrl:"https://example.com/review",status:"sent",sequence:1,scheduledAt:audit.createdAt,sentAt:audit.createdAt,deliveredAt:null,openedAt:null,clickedAt:null,confirmedAt:null,confirmedBy:null,messageId:"message-a",archivedAt:null });
  const clicked=recordReviewEngagement(request,"clicked","client",audit.updatedAt);
  assert.equal(clicked.status,"clicked");
  assert.equal(clicked.confirmedAt,null);
});

test("closeout remains blocked until every deterministic requirement has evidence", () => {
  const closeout=projectCloseoutSchema.parse({ ...audit,id:"close-a",tenantId:"tenant-a",projectId:"project-a",status:"blocked",requirements:[
    {key:"delivery",label:"Delivery sent",complete:true,evidenceId:"delivery-a"},
    {key:"balance",label:"Final balance settled",complete:false,evidenceId:null},
  ],completedAt:null,completedBy:null,summaryDocumentId:null,archivedAt:null });
  assert.deepEqual(evaluateCloseout(closeout).blockers,["Final balance settled"]);
});

test("report aggregates are deterministic and use integer cents", () => {
  assert.deepEqual(aggregateStudioReport([
    {type:"Wedding",leadSource:"Referral",booked:true,valueCents:600000,ready:true,coiTurnaroundDays:2,crewAccepted:true,scheduleRevisions:3},
    {type:"Corporate",leadSource:"Organic",booked:false,valueCents:0,ready:false,coiTurnaroundDays:null,crewAccepted:false,scheduleRevisions:0},
  ]),{inquiries:2,bookings:1,bookingConversionPercent:50,bookedValueCents:600000,readyPercent:100,crewAcceptancePercent:100,averageScheduleRevisions:3});
});
