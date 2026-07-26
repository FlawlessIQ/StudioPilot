import assert from "node:assert/strict";
import test from "node:test";
import { hashReplyToken, validateInboundPdf } from "@/server/services/inbound-coi-service";
test("reply routing stores only a one-way token hash",()=>{assert.equal(hashReplyToken("secret"),hashReplyToken("secret"));assert.notEqual(hashReplyToken("secret"),"secret")});
test("inbound COI files enforce PDF type and size",()=>{assert.doesNotThrow(()=>validateInboundPdf({contentType:"application/pdf",filename:"coi.pdf",sizeBytes:1000}));assert.throws(()=>validateInboundPdf({contentType:"image/png",filename:"coi.png",sizeBytes:1000}),/PDF/);assert.throws(()=>validateInboundPdf({contentType:"application/pdf",filename:"coi.pdf",sizeBytes:20*1024*1024}),/15 MB/)});
