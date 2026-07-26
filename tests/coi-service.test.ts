import assert from "node:assert/strict";
import test from "node:test";
import type { InsuranceRequest } from "@/features/insurance/schema";
import { CoiService } from "@/server/services/coi-service";
const request={id:"r",tenantId:"t",projectId:"p",requirementId:"req",status:"under_review",replyTokenHash:"hash",inboundMessageId:null,documentId:"d",extractedData:{},discrepancies:[],humanDecision:"pending",requestedAt:null,receivedAt:null,createdAt:"2026-01-01T00:00:00.000Z",updatedAt:"2026-01-01T00:00:00.000Z",createdBy:"u",updatedBy:"u",archivedAt:null} satisfies InsuranceRequest;
test("AI extraction cannot approve a COI",async()=>{const service=new CoiService({async getRequest(){return request},async recordDecision(){throw new Error("should not write")}});await assert.rejects(()=>service.decide({tenantId:"t",requestId:"r",actorId:"ai",canApprove:false,decision:"approved",reason:"AI matched fields"}),/permission/)});
test("human COI decisions require a reason",async()=>{const service=new CoiService({async getRequest(){return request},async recordDecision(){}});await assert.rejects(()=>service.decide({tenantId:"t",requestId:"r",actorId:"owner",canApprove:true,decision:"approved",reason:"ok"}),/reason/)});
