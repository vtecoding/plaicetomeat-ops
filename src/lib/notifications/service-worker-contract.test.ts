import { describe, expect, it } from "vitest";
import { acceptPushForDisplay, notificationClickUrl } from "./service-worker-contract";
const payload={schemaVersion:1,messageType:"owner_alert",dispatchId:"11111111-1111-4111-8111-111111111111",alertId:"33333333-3333-4333-8333-333333333333",alertKind:"operator_help",severity:"critical",title:"Urgent shop alert",body:"Open PTM.",route:"/admin/today",createdAt:"2026-07-15T17:00:00.000Z"};
describe("service-worker evidence contract",()=>{
  it("accepts a valid payload for display and stores its stable dispatch id",()=>{const result=acceptPushForDisplay(payload,[],100);expect(result.duplicate).toBe(false);expect(result.records[0].dispatchId).toBe(payload.dispatchId)});
  it("suppresses a duplicate without changing first-seen evidence",()=>{const first=acceptPushForDisplay(payload,[],100);const second=acceptPushForDisplay(payload,first.records,200);expect(second.duplicate).toBe(true);expect(second.records[0]).toMatchObject({firstSeenAt:100,lastSeenAt:200})});
  it("bounds local evidence to 500 records",()=>{const rows=Array.from({length:500},(_,i)=>({dispatchId:`00000000-0000-4000-8000-${String(i).padStart(12,"0")}`,firstSeenAt:i,lastSeenAt:i,schemaVersion:1}));expect(acceptPushForDisplay(payload,rows,1000).records).toHaveLength(500)});
  it("constructs a same-origin deep link carrying open evidence",()=>expect(notificationClickUrl("https://ptm.test","/admin/today?alert=1",payload.dispatchId)).toBe(`https://ptm.test/admin/today?alert=1&notification=${payload.dispatchId}`));
  it("rejects external deep links",()=>expect(()=>notificationClickUrl("https://ptm.test","https://evil.test",payload.dispatchId)).toThrow());
  it("rejects unknown future payload versions",()=>expect(()=>acceptPushForDisplay({...payload,schemaVersion:2},[],100)).toThrow());
});
