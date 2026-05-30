import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "PlaiceToMeat Ops",
    template: "%s | PlaiceToMeat Ops",
  },
  description: "Click-and-collect ordering and counter operations for PlaiceToMeat.",
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
