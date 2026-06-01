import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
