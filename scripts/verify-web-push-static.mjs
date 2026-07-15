import { readFileSync } from "node:fs";
const read=(path)=>readFileSync(new URL(`../${path}`,import.meta.url),"utf8");
const adapter=read("src/lib/notifications/web-push-channel.ts");const edge=read("supabase/functions/alert-dispatcher/index.ts");const sw=read("public/ptm-service-worker.js");const migration=read("supabase/migrations/202607151500_v18_web_push.sql");const fieldFix=read("supabase/migrations/202607152315_v18_phase35_web_push_field_fixes.sql");const worker=read("scripts/owner-alert-worker.mjs");const settings=read("src/app/admin/settings/notifications/notification-settings.tsx");const today=read("src/app/admin/today/page.tsx");
const checks=[
  ["CHANNEL_UNSUPPORTED is absent",![adapter,edge,sw,migration].some(v=>v.includes("CHANNEL_UNSUPPORTED"))],
  ["Web Push adapter contains no database write",!/(\.insert\(|\.update\(|\.delete\(|record_alert|acknowledge|resolve_owner)/.test(adapter)],
  ["service worker contains no acknowledgement or resolution call",!/(acknowledge_owner|resolve_owner|acknowledged_at|resolved_at)/.test(sw)],
  ["service worker validates explicit schema version",sw.includes("schemaVersion !== 1")],
  ["service worker deduplicates and tags by dispatch id",sw.includes("MAX_IDS = 500")&&sw.includes("tag: payload.dispatchId")],
  ["service worker rejects external routes",sw.includes('!value.startsWith("//")')],
  ["normal device fan-out uses canonical eligibility view",migration.includes("FROM public.eligible_owner_notification_devices_v18")],
  ["VAPID private key has no browser exposure",!read("src/app/api/owner/notifications/vapid-public-key/route.ts").includes("PRIVATE")],
  ["subscription plaintext is never logged",![adapter,edge,sw].some(v=>/console\..*(endpoint|p256dh|auth)/.test(v))],
  ["superseded verification work is cancelled durably",fieldFix.includes("notification_verification_dispatch_cancel_v18")&&fieldFix.includes("VERIFICATION_CHALLENGE_INACTIVE")],
  ["verification deep links reconstruct explicit confirmation",fieldFix.includes("&device=")&&settings.includes('searchParams.get("verify")')],
  ["shadow workers lease only their owned channels",edge.includes('?? "web_push"')&&worker.includes('p_channels: ["twilio_whatsapp"]')],
  ["owner-alert deep link exposes acknowledgement without resolution",today.includes("Acknowledge alert")&&!read("src/app/actions/owner-alert.ts").includes("resolve_owner")],
];
let pass=0;for(const[name,ok]of checks){console.log(`  ${ok?"PASS":"FAIL"}  ${name}`);if(ok)pass++;}console.log(`\nWeb Push static guard: ${pass}/${checks.length} passed.`);if(pass!==checks.length)process.exit(1);
