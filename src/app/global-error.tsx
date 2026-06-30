"use client";

import { useEffect } from "react";

// Last-resort recovery screen. global-error replaces the root layout, so it
// cannot rely on globals.css (the root layout — which imports it — failed to
// render). Everything here is inline-styled with literal "craft butcher" design
// tokens so the operator still sees a calm, branded page, never a raw stack trace.

const PAPER = "#f6f2ea";
const INK = "#20191a";
const MUTED = "#6b5f57";
const BRAND = "#0f5132";
const BRAND_50 = "#e7f0ea";
const CARD = "#fffdf8";
const LINE = "#e7ddce";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("global error", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 24,
          padding: 24,
          background: PAPER,
          color: INK,
          textAlign: "center",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        }}
      >
        <div data-testid="global-error" style={{ maxWidth: 380, width: "100%" }}>
          <h1 style={{ fontSize: 30, fontWeight: 600, margin: "0 0 8px" }}>Something went wrong</h1>
          <p style={{ fontSize: 18, color: MUTED, margin: "0 0 28px" }}>
            The app had a problem. You can try again or go back to the start.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                minHeight: 64,
                borderRadius: 16,
                border: `1px solid ${BRAND}`,
                background: BRAND_50,
                color: BRAND,
                fontSize: 20,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Try again
            </button>

            <a
              href="/operator"
              style={{
                minHeight: 64,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 16,
                border: `1px solid ${LINE}`,
                background: CARD,
                color: INK,
                fontSize: 20,
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              Go to start
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
