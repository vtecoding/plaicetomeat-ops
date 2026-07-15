import { describe, expect, it } from "vitest";
import { decryptNotificationSecret, encryptNotificationSecret, subscriptionFingerprint } from "./secret-box";
const key=btoa(String.fromCharCode(...Array.from({length:32},(_,i)=>i)));
describe("notification subscription secret box",()=>{
  it("round-trips AES-GCM ciphertext without retaining plaintext",async()=>{const encrypted=await encryptNotificationSecret("https://push.example/id",key);expect(encrypted).not.toContain("push.example");await expect(decryptNotificationSecret(encrypted,key)).resolves.toBe("https://push.example/id")});
  it("creates deterministic subscription identity without using endpoint as device identity",async()=>{const a=await subscriptionFingerprint("https://push.example/id","auth","key");const b=await subscriptionFingerprint("https://push.example/id","auth","key");expect(a).toBe(b);expect(a).toMatch(/^[0-9a-f]{64}$/)});
});
