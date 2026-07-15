// V18 B1 Phase 3 database/integration guard. No real provider is contacted:
// provider acceptance is recorded through the sealed lease/result contract.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env=Object.fromEntries(readFileSync(new URL("../.env.local",import.meta.url),"utf8").split(/\r?\n/).filter(l=>l&&!l.startsWith("#")&&l.includes("=")).map(l=>[l.slice(0,l.indexOf("=")).trim(),l.slice(l.indexOf("=")+1).trim()]));
const admin=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const owner=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false}});
let pass=0,fail=0; const alertIds=[]; const deviceIds=[];
function check(name,condition,detail=""){if(condition){pass++;console.log(`  PASS  ${name}${detail?`  ::  ${detail}`:""}`)}else{fail++;console.log(`  FAIL  ${name}${detail?`  ::  ${detail}`:""}`)}}
async function rpc(client,name,args={}){const{data,error}=await client.rpc(name,args);if(error)throw new Error(`${name}: ${error.message}`);return data}
async function register(installation,fingerprint="a".repeat(64)){return rpc(owner,"register_owner_notification_device_v18",{p_branch_id:branchId,p_installation_id:installation,p_device_label:"Guard browser",p_platform:"test",p_user_agent:"guard",p_endpoint_ciphertext:"v1.endpoint-ciphertext-guard",p_auth_ciphertext:"v1.auth-ciphertext-guard",p_p256dh_ciphertext:"v1.p256dh-ciphertext-guard",p_subscription_fingerprint:fingerprint})}
async function accept(dispatchId,worker="web-push:guard"){const rows=await rpc(admin,"lease_alert_dispatches_v18",{p_worker_id:worker,p_limit:25,p_lease_seconds:60});if(!rows.some(r=>r.id===dispatchId))throw new Error(`could not lease ${dispatchId}`);return rpc(admin,"record_alert_dispatch_result_v18",{p_dispatch_id:dispatchId,p_worker_id:worker,p_outcome:"accepted",p_provider_status_code:"201",p_provider_message_id:null,p_error_code:null,p_error_detail:null,p_invalidate_device:false})}
async function verify(deviceId){const challenge=await rpc(owner,"create_owner_notification_verification_v18",{p_device_id:deviceId});await accept(challenge.dispatch_id,`verify:${deviceId.slice(0,6)}`);return {challenge,confirmed:await rpc(owner,"confirm_owner_notification_verification_v18",{p_device_id:deviceId,p_challenge_id:challenge.challenge_id})}}
async function eligible(deviceId){const{count}=await admin.from("eligible_owner_notification_devices_v18").select("id",{count:"exact",head:true}).eq("id",deviceId);return count??0}
async function createAlert(summary){const id=crypto.randomUUID();alertIds.push(id);const{error}=await admin.from("owner_alerts").insert({id,branch_id:branchId,severity:"critical",kind:"operator_help",summary,entity_ref:`web-push-guard:${id}`});if(error)throw error;return id}

let branchId,ownerId;
try{
  const login=await owner.auth.signInWithPassword({email:"owner@ptm.test",password:"PlaiceTest123!"});if(login.error)throw login.error;ownerId=login.data.user.id;
  const profile=await admin.from("profiles").select("branch_id").eq("id",ownerId).single();branchId=profile.data.branch_id;
  const installation=crypto.randomUUID();
  const [regA,regB]=await Promise.all([register(installation),register(installation)]);const deviceId=regA.device_id;deviceIds.push(deviceId);
  const sameRows=await admin.from("owner_notification_devices").select("id",{count:"exact"}).eq("owner_id",ownerId).eq("installation_id",installation).eq("channel","web_push");
  check("concurrent registration converges on one unverified device",regA.device_id===regB.device_id&&sameRows.count===1&&regA.status==="unverified",JSON.stringify({deviceId,count:sameRows.count}));
  check("unverified device is not eligible",await eligible(deviceId)===0);

  const superseded=await rpc(owner,"create_owner_notification_verification_v18",{p_device_id:deviceId});
  const current=await rpc(owner,"create_owner_notification_verification_v18",{p_device_id:deviceId});
  const oldDispatch=(await admin.from("alert_dispatches").select("status").eq("id",superseded.dispatch_id).single()).data;
  const currentDispatch=(await admin.from("alert_dispatches").select("payload").eq("id",current.dispatch_id).single()).data;
  check("superseded verification dispatch debt is cancelled",oldDispatch.status==="cancelled");
  check("verification deep link carries challenge and device identity",currentDispatch.payload.route.includes(`verify=${current.challenge_id}`)&&currentDispatch.payload.route.includes(`device=${deviceId}`));
  await accept(current.dispatch_id,`verify:${deviceId.slice(0,6)}`);const first={challenge:current,confirmed:await rpc(owner,"confirm_owner_notification_verification_v18",{p_device_id:deviceId,p_challenge_id:current.challenge_id})};
  check("provider-accepted verification makes the device eligible",first.confirmed.status==="active"&&await eligible(deviceId)===1);
  const replay=await rpc(owner,"confirm_owner_notification_verification_v18",{p_device_id:deviceId,p_challenge_id:first.challenge.challenge_id});
  check("identical verification confirmation replay is idempotent",replay.verified_at===first.confirmed.verified_at);

  const alertId=await createAlert("Web Push fan-out guard");
  const dispatches=await admin.from("alert_dispatches").select("id,channel,device_id").eq("alert_id",alertId);
  const webDispatch=dispatches.data.find(d=>d.channel==="web_push");
  check("eligible device receives its own deterministic Web Push dispatch",dispatches.data.filter(d=>d.channel==="web_push").length===1&&webDispatch.device_id===deviceId,JSON.stringify(dispatches.data));
  const scoped=await rpc(admin,"lease_alert_dispatches_for_channels_v18",{p_worker_id:"open:guard",p_channels:["web_push"],p_limit:25,p_lease_seconds:60});
  const legacyAfterScoped=(await admin.from("alert_dispatches").select("status").eq("alert_id",alertId).eq("channel","twilio_whatsapp").single()).data;
  check("channel-scoped leasing claims Web Push without consuming the legacy row",scoped.some(row=>row.id===webDispatch.id)&&scoped.every(row=>row.channel==="web_push")&&legacyAfterScoped.status==="pending");
  const accepted=await rpc(admin,"record_alert_dispatch_result_v18",{p_dispatch_id:webDispatch.id,p_worker_id:"open:guard",p_outcome:"accepted",p_provider_status_code:"201",p_provider_message_id:null,p_error_code:null,p_error_detail:null,p_invalidate_device:false});
  const opened1=await rpc(owner,"record_owner_notification_opened_v18",{p_dispatch_id:webDispatch.id});
  const opened2=await rpc(owner,"record_owner_notification_opened_v18",{p_dispatch_id:webDispatch.id});
  const alertAfterOpen=await admin.from("owner_alerts").select("acknowledged_at,resolved_at").eq("id",alertId).single();
  check("first open wins and replay neither acknowledges nor resolves",accepted.provider_accepted_at&&opened1.changed===true&&opened2.changed===false&&opened1.notification_opened_at===opened2.notification_opened_at&&!alertAfterOpen.data.acknowledged_at&&!alertAfterOpen.data.resolved_at);

  await rpc(owner,"set_owner_notification_device_enabled_v18",{p_device_id:deviceId,p_enabled:false,p_reason:"guard"});
  const disabledAlert=await createAlert("Disabled exclusion guard");const disabledRows=await admin.from("alert_dispatches").select("id",{count:"exact"}).eq("alert_id",disabledAlert).eq("channel","web_push");
  check("disabled device is ineligible and receives no future dispatch",await eligible(deviceId)===0&&disabledRows.count===0);
  await rpc(owner,"set_owner_notification_device_enabled_v18",{p_device_id:deviceId,p_enabled:true,p_reason:null});
  check("verified non-invalidated device can be re-enabled",await eligible(deviceId)===1);

  const invalidAlert=await createAlert("Invalidation isolation guard");const invalidDispatch=(await admin.from("alert_dispatches").select("id").eq("alert_id",invalidAlert).eq("channel","web_push").single()).data;
  const worker="invalidate:guard";await rpc(admin,"lease_alert_dispatches_v18",{p_worker_id:worker,p_limit:25,p_lease_seconds:60});
  await rpc(admin,"record_alert_dispatch_result_v18",{p_dispatch_id:invalidDispatch.id,p_worker_id:worker,p_outcome:"rejected_permanent",p_provider_status_code:"410",p_provider_message_id:null,p_error_code:"PUSH_SUBSCRIPTION_INVALID",p_error_detail:"gone",p_invalidate_device:true});
  const invalidDevice=(await admin.from("owner_notification_devices").select("enabled,invalidated_at,invalidation_provider_code").eq("id",deviceId).single()).data;
  const reenable=await owner.rpc("set_owner_notification_device_enabled_v18",{p_device_id:deviceId,p_enabled:true,p_reason:null});
  check("provider invalidation preserves row, provider code, isolation and direct re-enable block",!invalidDevice.enabled&&invalidDevice.invalidated_at&&invalidDevice.invalidation_provider_code==="410"&&await eligible(deviceId)===0&&Boolean(reenable.error));

  const replaced=await register(installation,"b".repeat(64));const replacedRow=(await admin.from("owner_notification_devices").select("verified_at,invalidated_at,enabled").eq("id",deviceId).single()).data;
  check("new subscription clears invalidation but requires re-verification",replaced.device_id===deviceId&&replaced.verification_required===true&&!replacedRow.verified_at&&!replacedRow.invalidated_at&&replacedRow.enabled&&await eligible(deviceId)===0);
  const oldChallenge=await owner.rpc("confirm_owner_notification_verification_v18",{p_device_id:deviceId,p_challenge_id:first.challenge.challenge_id});
  check("a challenge for replaced subscription credentials cannot verify",Boolean(oldChallenge.error));

  const exp=await rpc(owner,"create_owner_notification_verification_v18",{p_device_id:deviceId});await accept(exp.dispatch_id,"expired:guard");await admin.from("owner_notification_verification_challenges").update({created_at:"2000-01-01T00:00:00Z",expires_at:"2000-01-01T00:15:00Z"}).eq("id",exp.challenge_id);
  await rpc(admin,"expire_owner_notification_verifications_v18");const expired=await owner.rpc("confirm_owner_notification_verification_v18",{p_device_id:deviceId,p_challenge_id:exp.challenge_id});const expiredRow=(await admin.from("owner_notification_verification_challenges").select("status").eq("id",exp.challenge_id).single()).data;
  check("expired verification challenge is durable, audited and cannot verify",expiredRow.status==="expired"&&Boolean(expired.error));

  const manager=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false}});await manager.auth.signInWithPassword({email:"manager@ptm.test",password:"PlaiceTest123!"});
  const foreign=await manager.rpc("set_owner_notification_device_enabled_v18",{p_device_id:deviceId,p_enabled:false,p_reason:"malicious"});
  check("non-owner cannot mutate an owner's device",Boolean(foreign.error));

  const secondReg=await register(crypto.randomUUID(),"c".repeat(64));deviceIds.push(secondReg.device_id);await verify(deviceId);await verify(secondReg.device_id);
  const multiAlert=await createAlert("Independent device fan-out guard");const multi=(await admin.from("alert_dispatches").select("device_id").eq("alert_id",multiAlert).eq("channel","web_push")).data;
  check("two active devices receive independent dispatch rows",multi.length===2&&new Set(multi.map(r=>r.device_id)).size===2,JSON.stringify(multi));
}finally{
  if(alertIds.length)await admin.from("owner_alerts").delete().in("id",alertIds);
  if(deviceIds.length){await admin.from("alert_dispatches").delete().in("device_id",deviceIds);await admin.from("owner_notification_devices").delete().in("id",deviceIds);}
}
console.log(`\nWeb Push guard: ${pass} passed, ${fail} failed.`);if(fail)process.exit(1);
