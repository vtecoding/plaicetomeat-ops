import { readFileSync } from "node:fs";
const read=(path)=>readFileSync(new URL(`../${path}`,import.meta.url),"utf8");
const adapter=read("src/lib/notifications/web-push-channel.ts");const edge=read("supabase/functions/alert-dispatcher/index.ts");const sw=read("public/ptm-service-worker.js");const migration=read("supabase/migrations/202607151500_v18_web_push.sql");
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
];
let pass=0;for(const[name,ok]of checks){console.log(`  ${ok?"PASS":"FAIL"}  ${name}`);if(ok)pass++;}console.log(`\nWeb Push static guard: ${pass}/${checks.length} passed.`);if(pass!==checks.length)process.exit(1);
