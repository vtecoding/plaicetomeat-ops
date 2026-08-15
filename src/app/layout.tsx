import type { Metadata } from "next";
import { Fraunces, Inter, Noto_Nastaliq_Urdu } from "next/font/google";
import { Suspense } from "react";
import "./globals.css";
import { NotificationOpenRecorder } from "@/components/notification-open-recorder";
import { OPERATOR_DOCUMENT_LANGUAGE_BOOTSTRAP } from "@/lib/operator/i18n/document-bootstrap";

// UI / body — Inter, properly bundled (previously only named in CSS, so it silently fell
// back to the system font, which is a big part of why the app felt generic).
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

// Display — Fraunces, an expressive "old-style" serif with optical sizing. Gives headings
// and the wordmark a crafted, food-brand character instead of a default sans.
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  style: ["normal", "italic"],
});

// Optional Pashto presentation style. The words remain the same; this bundled
// font only changes their calligraphic rendering when the operator enables it.
const notoNastaliq = Noto_Nastaliq_Urdu({
  subsets: ["arabic"],
  variable: "--font-nastaliq",
  display: "swap",
  weight: "variable",
});

export const metadata: Metadata = {
  title: {
    default: "PlaiceToMeat Wylde Green — Halal Butcher",
    template: "%s | PlaiceToMeat",
  },
  description: "Order your halal meat online and collect fresh from PlaiceToMeat in Wylde Green.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      translate="yes"
      suppressHydrationWarning
      className={`${inter.variable} ${fraunces.variable} ${notoNastaliq.variable}`}
    >
      <head>
        <script
          id="operator-document-language"
          dangerouslySetInnerHTML={{ __html: OPERATOR_DOCUMENT_LANGUAGE_BOOTSTRAP }}
        />
      </head>
      <body><Suspense fallback={null}><NotificationOpenRecorder /></Suspense>{children}</body>
    </html>
  );
}
