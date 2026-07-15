"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type Device = { id:string; deviceLabel:string|null; platform:string|null; enabled:boolean; verifiedAt:string|null;
  disabledAt:string|null; invalidatedAt:string|null; invalidationReason:string|null; lastSuccessAt:string|null; lastFailureAt:string|null;
  status:"unverified"|"active"|"disabled"|"invalidated" };

function base64Key(value: string) {
  const padded = value.padEnd(value.length + (4 - value.length % 4) % 4, "=").replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}
function installationId() {
  const key = "ptm_notification_installation_id"; let value = localStorage.getItem(key);
  if (!value) { value = crypto.randomUUID(); localStorage.setItem(key, value); } return value;
}

export function NotificationSettings({ initialDevices }: { initialDevices: Device[] }) {
  const router=useRouter(); const searchParams=useSearchParams();
  const [devices, setDevices] = useState(initialDevices); const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false); const [verification, setVerification] = useState<{deviceId:string;challengeId:string}|null>(null);
  const [browserState,setBrowserState]=useState("Checking browser support…");const [rename,setRename]=useState<{id:string;label:string}|null>(null);
  const support = useMemo(() => typeof window !== "undefined" && window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window, []);
  useEffect(()=>setBrowserState(!support?"Notifications unsupported in this browser mode":`Browser permission: ${Notification.permission}`),[support]);
  useEffect(()=>{const challengeId=searchParams.get("verify");const requestedDevice=searchParams.get("device");if(!challengeId||!/^[0-9a-f-]{36}$/i.test(challengeId))return;
    const candidates=devices.filter(device=>device.status==="unverified"&&(!requestedDevice||device.id===requestedDevice));
    if(candidates.length===1)setVerification({deviceId:candidates[0].id,challengeId});},[devices,searchParams]);
  async function refresh() { const response=await fetch("/api/owner/notifications/devices"); if(response.ok)setDevices((await response.json()).devices); }
  async function enable() {
    if (!support) { setMessage("This browser cannot receive PTM notifications in its current installed mode."); return; }
    setBusy(true); setMessage("");
    try {
      const permission=await Notification.requestPermission(); if(permission!=="granted") throw new Error("Notifications are blocked in this browser.");
      const registration=await navigator.serviceWorker.register("/ptm-service-worker.js",{scope:"/"});
      const keyResponse=await fetch("/api/owner/notifications/vapid-public-key"); const keyBody=await keyResponse.json();
      if(!keyResponse.ok) throw new Error(keyBody.error);
      const subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:base64Key(keyBody.publicKey)});
      const response=await fetch("/api/owner/notifications/devices",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
        installationId:installationId(),deviceLabel:"This browser",platform:navigator.platform,userAgent:navigator.userAgent,subscription:subscription.toJSON(),
      })}); const body=await response.json(); if(!response.ok)throw new Error(body.error);
      const test=await fetch(`/api/owner/notifications/devices/${body.device_id}/test`,{method:"POST"}); const testBody=await test.json(); if(!test.ok)throw new Error(testBody.error);
      setVerification({deviceId:body.device_id,challengeId:testBody.challenge_id}); setMessage("Test sent. Open it, then confirm below."); await refresh();
    } catch(error) { setMessage(error instanceof Error?error.message:"Notification setup failed."); } finally { setBusy(false); }
  }
  async function confirm() {
    if(!verification)return; setBusy(true); const response=await fetch(`/api/owner/notifications/devices/${verification.deviceId}/verify`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({challengeId:verification.challengeId})});
    const body=await response.json(); setMessage(response.ok?"Notifications active.":body.error); if(response.ok){setVerification(null);router.replace("/admin/settings/notifications");} await refresh(); setBusy(false);
  }
  async function sendTest(deviceId:string){setBusy(true);const response=await fetch(`/api/owner/notifications/devices/${deviceId}/test`,{method:"POST"});const body=await response.json();if(response.ok){setVerification({deviceId,challengeId:body.challenge_id});setMessage("Test sent. Open it, then confirm below.")}else setMessage(body.error);setBusy(false)}
  async function state(device:Device,action:"enable"|"disable") { setBusy(true); const response=await fetch(`/api/owner/notifications/devices/${device.id}/state`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action})}); const body=await response.json(); setMessage(response.ok?"Notification device updated.":body.error); await refresh(); setBusy(false); }
  async function saveName(){if(!rename)return;setBusy(true);const response=await fetch(`/api/owner/notifications/devices/${rename.id}/state`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"rename",deviceLabel:rename.label})});const body=await response.json();setMessage(response.ok?"Device renamed.":body.error);if(response.ok)setRename(null);await refresh();setBusy(false)}
  return <div className="grid gap-5">
    <div className="rounded-xl border border-[#e7c9a0] bg-[#fffaf2] p-4"><p className="font-semibold">Receive urgent shop alerts on this device</p><p className="mt-1 text-sm text-[var(--muted)]">PTM sends a real test first. Permission alone never marks notifications ready.</p><p className="mt-1 text-xs font-semibold">{browserState}</p>
      <button disabled={busy||Boolean(verification)} onClick={enable} className="mt-3 rounded-full bg-[#0f5132] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Enable notifications</button>
      {verification&&<button disabled={busy} onClick={confirm} className="ml-2 mt-3 rounded-full border px-4 py-2 text-sm font-bold">I received the test</button>}
      {message&&<p className="mt-3 text-sm font-semibold" role="status">{message}</p>}</div>
    {devices.map(device=><article key={device.id} className="rounded-xl border bg-white p-4"><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">{device.deviceLabel??"Notification device"}</h2><p className="text-sm text-[var(--muted)]">{device.status==="active"?"Notifications active":device.status==="unverified"?"Needs verification":device.status==="invalidated"?"Connection expired — reconnect notifications":"Device disabled"}</p></div><span className="rounded-full bg-[#f3efe8] px-3 py-1 text-xs font-bold uppercase">{device.status}</span></div>
      {device.invalidationReason&&<p className="mt-2 text-sm">Problem: {device.invalidationReason}</p>}
      <p className="mt-2 text-xs text-[var(--muted)]">Last success: {device.lastSuccessAt?new Date(device.lastSuccessAt).toLocaleString():"Not yet"} · Last failure: {device.lastFailureAt?new Date(device.lastFailureAt).toLocaleString():"None"}</p>
      {rename?.id===device.id?<div className="mt-3 flex gap-2"><input aria-label="Device name" value={rename.label} maxLength={80} onChange={event=>setRename({...rename,label:event.target.value})} className="min-w-0 rounded-lg border px-3 py-1.5 text-sm"/><button disabled={busy} onClick={saveName} className="rounded-full border px-3 py-1.5 text-sm font-bold">Save name</button></div>:<button disabled={busy} onClick={()=>setRename({id:device.id,label:device.deviceLabel??"This browser"})} className="mt-3 rounded-full border px-3 py-1.5 text-sm font-bold">Rename device</button>}
      {device.status==="unverified"&&!verification&&<button disabled={busy} onClick={()=>sendTest(device.id)} className="ml-2 mt-3 rounded-full border px-3 py-1.5 text-sm font-bold">Send test notification</button>}
      {device.status==="active"&&<button disabled={busy} onClick={()=>state(device,"disable")} className="mt-3 rounded-full border px-3 py-1.5 text-sm font-bold">Disable device</button>}
      {device.status==="disabled"&&<button disabled={busy} onClick={()=>state(device,"enable")} className="mt-3 rounded-full border px-3 py-1.5 text-sm font-bold">Re-enable device</button>}
      {device.status==="invalidated"&&<button disabled={busy} onClick={enable} className="mt-3 rounded-full border px-3 py-1.5 text-sm font-bold">Reconnect notifications</button>}
    </article>)}
    {!devices.length&&<p className="rounded-xl border bg-white p-4 text-sm">No notification device registered.</p>}
  </div>;
}
