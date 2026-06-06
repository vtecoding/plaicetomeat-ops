import { chromium } from "@playwright/test";
import { join, dirname } from "node:path"; import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)),"..");
const OUT = join(ROOT,"docs","full-audit-pack","screenshots");
const BASE="http://127.0.0.1:3100";
const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:1366,height:900}}); const p = await ctx.newPage();
await p.goto(BASE+"/login",{waitUntil:"networkidle"});
await p.fill("#email","owner@ptm.test"); await p.fill("#password","PlaiceTest123!");
await Promise.all([p.waitForLoadState("networkidle"), p.click('button[type=submit]')]); await p.waitForTimeout(1200);
// counter order detail via known seed order id
const oid="0a2f28e7-3d70-4ed2-8b7c-593ac00206dd";
const r = await p.goto(`${BASE}/counter/orders/${oid}`,{waitUntil:"networkidle"}); await p.waitForTimeout(800);
await p.screenshot({path:join(OUT,"staff-02-counter-order.png"),fullPage:true});
console.log("counter-order", r.status());
// decision links present?
await p.goto(BASE+"/admin/today",{waitUntil:"networkidle"});
const hrefs = await p.$$eval('a[href^="/admin/today/"]', els=>els.map(e=>e.getAttribute("href")).filter(h=>h && !/walk/.test(h)));
console.log("decision links:", JSON.stringify(hrefs));
if(hrefs[0]){ const r2=await p.goto(BASE+hrefs[0],{waitUntil:"networkidle"}); await p.waitForTimeout(800); await p.screenshot({path:join(OUT,"admin-02-decision-card.png"),fullPage:true}); console.log("decision-card",hrefs[0],r2.status()); }
await b.close();
