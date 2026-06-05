import type { NextConfig } from "next";

// V11.1 — security headers (spec §8.1.5). Applied to every route.
//
// CSP note: script-src currently allows 'unsafe-inline' because the Next.js App
// Router emits inline bootstrap scripts and this build has no per-request nonce
// pipeline yet. Removing 'unsafe-inline' requires middleware nonce plumbing +
// a production-build verification cycle and is tracked as a V11.1 follow-up. All
// other directives are strict (default-src 'self', object-src 'none',
// frame-ancestors 'none', base-uri/form-action 'self').

const isProd = process.env.NODE_ENV === "production";

function supabaseOrigins(): { http: string; ws: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return { http: "", ws: "" };
  try {
    const u = new URL(url);
    return { http: `${u.protocol}//${u.host}`, ws: `${u.protocol === "https:" ? "wss" : "ws"}://${u.host}` };
  } catch {
    return { http: "", ws: "" };
  }
}

function contentSecurityPolicy(): string {
  const { http, ws } = supabaseOrigins();
  const connect = ["'self'", http, ws].filter(Boolean).join(" ");
  const scriptExtra = isProd ? "" : " 'unsafe-eval'"; // Turbopack/HMR needs eval in dev only
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${scriptExtra}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${connect}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy() },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
  ...(isProd
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
    : []),
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
