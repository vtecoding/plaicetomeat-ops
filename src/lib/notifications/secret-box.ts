const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function importKey(keyBase64: string) {
  const bytes = base64ToBytes(keyBase64);
  if (bytes.byteLength !== 32) throw new Error("Notification encryption key must decode to 32 bytes.");
  return crypto.subtle.importKey("raw", new Uint8Array(bytes).buffer, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptNotificationSecret(value: string, keyBase64: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await importKey(keyBase64), encoder.encode(value));
  return `v1.${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(encrypted))}`;
}

export async function decryptNotificationSecret(value: string, keyBase64: string): Promise<string> {
  const [version, iv, ciphertext] = value.split(".");
  if (version !== "v1" || !iv || !ciphertext) throw new Error("Encrypted notification secret is malformed.");
  const clear = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(base64ToBytes(iv)).buffer },
    await importKey(keyBase64),
    new Uint8Array(base64ToBytes(ciphertext)).buffer,
  );
  return decoder.decode(clear);
}

export async function subscriptionFingerprint(endpoint: string, auth: string, p256dh: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`${endpoint}\n${auth}\n${p256dh}`));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
