import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Örebro kartverkstad",
  description: "Bygg och testa ruttnät för Ticket to Ride Örebro.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="sv">
      <body className="antialiased">{children}</body>
    </html>
  );
}
